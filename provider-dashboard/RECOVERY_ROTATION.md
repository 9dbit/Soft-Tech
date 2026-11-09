# Provider backup keys, vault rotation and rollback preparation

The offline commands prepare verified recovery artifacts without replacing the current database or switching traffic. The optional preproduction startup wrapper performs an explicitly configured cutover to a fresh path only after verification. Neither flow grants project go-live approval. The operator controls the maintenance window and service configuration.

## Backup key ring

New snapshots use **STBK02**. The key ID, creation time, plaintext checksum, plaintext size and immutable database deployment identity are authenticated as AES-GCM associated data. A changed key label is rejected even if two labels happen to contain the same key. The restored SQLite file also passes integrity and foreign-key checks, and its actual deployment identity must match the authenticated manifest.

Set `BACKUP_KEYS_JSON` to an object mapping key IDs to independent, high-entropy passphrases of at least 24 characters, and select the writer using `BACKUP_ACTIVE_KEY_ID`. The legacy `BACKUP_PASSPHRASE` is mapped to the key ID `legacy`; existing deployments continue to work with that variable alone. Retain the `legacy` entry to restore old **STBK01** archives. New code reads STBK01 and STBK02; old STBK01-only tools do not read STBK02.

The file alternatives are `BACKUP_KEYS_JSON_FILE` and `BACKUP_PASSPHRASE_FILE`. Each must refer to a private regular file with no group/other access. A value and its file alternative cannot both be configured. Key contents never belong in command arguments, reports or version control.

To rotate backup encryption:

1. Add a new independent key to the ring without removing existing entries.
2. Change `BACKUP_ACTIVE_KEY_ID` to its new ID.
3. Produce a new snapshot, download it, and restore it into a fresh disposable path with the current tools.
4. Restore an older archive with the same retained ring. Verify its deployment identity and application state.
5. Retain decrypt keys for every surviving archive and rollback checkpoint. A key is not retired just because it is no longer the active writer.

Offsite backups of deployment-bound Core databases use `provider-core/<environment>/<deployment_id>/<epoch>-<checksum-prefix>-<nonce>.stbk`. Older paths and backups without deployment identity remain readable and are not automatically treated as retention-owned objects. The uploader rejects a database identity that conflicts with explicit `CORE_DEPLOYMENT_ID` or `CORE_ENVIRONMENT` configuration.

Restore publishes its verified output atomically and refuses existing files, including dangling symlinks and racing destination creation:

```sh
node scripts/sqlite-backup.mjs backup /data/provider.sqlite /recovery/provider-new.stbk
node scripts/sqlite-backup.mjs restore /recovery/provider-new.stbk /recovery/verified.sqlite
```

## Offline Core master-key rotation

Keep the old and new master secrets in the secure secret system. Supply them through `CORE_OLD_MASTER_SECRET` / `CORE_NEW_MASTER_SECRET`, or through their `_FILE` alternatives. Each must contain at least 32 characters, and they must differ. The command requires the expected `CORE_DEPLOYMENT_ID` and `CORE_ENVIRONMENT`, the backup key ring, and an explicit `--offline` acknowledgement.

Example using pre-provisioned private secret files:

```sh
export CORE_OLD_MASTER_SECRET_FILE=/run/secrets/provider-master-old
export CORE_NEW_MASTER_SECRET_FILE=/run/secrets/provider-master-new
export BACKUP_KEYS_JSON_FILE=/run/secrets/provider-backup-keys
export BACKUP_ACTIVE_KEY_ID=backup-current
export CORE_DEPLOYMENT_ID=the-existing-provider-deployment-id
export CORE_ENVIRONMENT=sandbox

node scripts/rotate-core-master.mjs rotate \
  /data/provider.sqlite \
  /recovery/provider-with-new-master.sqlite \
  /recovery/before-master-change.stbk \
  --offline
```

Stop or quiesce every writer before taking this cutover snapshot. The tool observes SQLite's data-version counter and refuses to publish when a write occurs during preparation. The acknowledgement is an operational assertion; it cannot prevent another process from writing after the check. Continue to keep the original writer stopped until the cutover is resolved.

The command first takes an isolated consistent SQLite copy. It creates an encrypted rollback checkpoint and verifies that checkpoint against the original logical data and vault plaintexts. Inside one transaction in the isolated copy, it rewraps:

| Table | Encrypted field |
| --- | --- |
| `meta` | `vault_check` sentinel |
| `operators` | `wallet_secret` |
| `api_keys` | `secret_box` |
| `sessions` | `launch_box` |
| `idempotency` | `response_box` |
| `staff_users` | `totp_secret_box` |
| `staff_enrollments` | `secret_box` |

It refuses an unrecognized future `_box` column so that new encrypted state cannot be silently omitted. It checks that all rewrapped plaintexts and the remaining logical application data are preserved, verifies the new vault key, and confirms the old vault key is rejected.

The prepared copy removes shared panel sessions and MFA login challenges; revokes staff sessions; expires pending MFA enrollment tokens; consumes outstanding invitation tokens; and advances staff credential versions so pending staff release authority is invalidated. It retains staff passwords, TOTP secrets and replay counters, recovery-code hashes, roles and immutable signoffs. Pending enrollment ciphertexts are rewrapped before their tokens are expired. Named staff must sign in again after cutover.

Player sessions, operator credentials, wallet credentials, replay nonces, rounds, ledger entries and idempotency values are preserved. This operation rotates their encryption at rest; it does not change the external signing secrets themselves. Rotate compromised external credentials separately through their existing issuance/revocation flows.

Only after all verification succeeds is the fresh output database published. Review the JSON receipt, then perform an operator-controlled deployment using the fresh database path and matching new `PANEL_SESSION_SECRET`. Run the application smoke/reconciliation checks before resuming traffic. Use a single authoritative writer. The original database remains untouched by this command.

## Optional preproduction startup cutover

`scripts/start-provider.mjs` runs the rotation guard before importing `server.mjs`. Use it as the service start command only after reviewing and scheduling the maintenance window. This is an application startup operation on the mounted volume; a pre-deploy job without that volume cannot perform it. This wrapper is restricted to `CORE_ENVIRONMENT=preproduction`. The normal offline command remains available for separately controlled rotations elsewhere.

Before enabling it, stop the qualification runner and drain accepted work. Confirm one replica, zero deployment overlap, no old service or shell process writing the source, and enough free space for the source, fresh rotated database, encrypted checkpoint and temporary verification copies. The offline acknowledgement is an operator assertion; the process cannot prove the platform has stopped every other writer. Keep the previous writer stopped throughout preparation and cutover.

Configure these values together through the protected service configuration. The following paths are examples on the same existing `/data` volume:

| Variable | Value / requirement |
| --- | --- |
| Start command | `node scripts/start-provider.mjs` |
| `CORE_ENVIRONMENT` | `preproduction` |
| `CORE_DEPLOYMENT_ID` | The existing immutable Core deployment ID |
| `CORE_MASTER_ROTATION_ON_START` | `true` |
| `CORE_MASTER_ROTATION_OFFLINE` | `true` for initial preparation, acknowledging the drained single writer |
| `CORE_MASTER_ROTATION_SOURCE_PATH` | `/data/provider.sqlite`, the existing database under the old master |
| `CORE_DB_PATH` | `/data/provider-master-rotated.sqlite`, a fresh path |
| `CORE_MASTER_ROTATION_ROLLBACK_PATH` | `/data/provider-before-master-change.stbk`, a fresh checkpoint path |
| `CORE_MASTER_ROTATION_RECEIPT_PATH` | Optional; defaults to `CORE_DB_PATH + .rotation.json` |
| `PANEL_SESSION_SECRET` | The new runtime master, at least 32 characters |
| `CORE_OLD_MASTER_SECRET` | The previous master, required only for first preparation |
| `BACKUP_KEYS_JSON` / `BACKUP_ACTIVE_KEY_ID` | Retained backup ring and active checkpoint encryption key |

Secret-file alternatives are supported. If `CORE_NEW_MASTER_SECRET` is also supplied, it must equal the new `PANEL_SESSION_SECRET`. The guard removes old/new maintenance-secret variables from the environment before importing the server; the server retains only its new runtime master and its normal backup ring. Removing a variable from the process environment is not a secure erasure guarantee. Remove the old maintenance secret from the service configuration after a verified restart, while keeping its approved recovery copy outside the running service.

All five paths (source, output, checkpoint, receipt and receipt's `.preparing` marker) must be distinct, in the same physical directory, and on the attached Railway volume when that mount is configured. Existing files must be private regular files without symlink or hard-link aliases. First startup refuses any unmarked output/checkpoint or leftover output SQLite sidecars.

The guard validates the old database and key, fingerprints the frozen source database and WAL, and atomically creates an authenticated `.preparing` marker. It invokes the offline rotation, verifies the fresh result and encrypted rollback checkpoint, and atomically publishes the completed receipt. Both marker and receipt are authenticated with an HMAC under the new master. A crash or failure before completed receipt publication leaves a visible incomplete preparation and refuses subsequent automatic startup. Preserve the files and investigate; never delete the markers merely to make a failed deployment start.

On a completed restart, the guard requires both records, their matching preparation ID and configured paths, the exact deployment identity, unchanged frozen source bytes and WAL, an unchanged rollback checkpoint, and a current database whose sentinel and every registered encrypted field open with the new master. Its `master_rotation_id` must match the receipt. It does not require the old master or the backup decrypt key just to start an already verified current database, and it never reruns rotation. Keep the checkpoint's decrypt key in the backup ring so recovery remains possible.

The live database's initial SHA256 is historical cutover evidence. Legitimate post-cutover transactions change its bytes, so restarts verify its current integrity, identity and vault instead of comparing it to the initial byte hash. The retired source is different: any detected byte/WAL change after cutover refuses startup because it could indicate a second writer or an attempted stale cutover. A benign manual checkpoint of that retired source also changes the fingerprint; preserve it without opening it for writes. This check runs during startup, not as a continuous cross-process lock.

The structured `provider.master_rotation_startup` log records the rotation ID, verified database identity, current path, receipt/checkpoint paths, verification counts and whether this startup prepared or resumed the rotation. It never logs secrets. Before restarting qualification, confirm the health identity, preserved operator/session/round state, pending-work reconciliation and a new remotely restored backup under the active backup key. Repeat a process restart without the old maintenance secret and verify the same rotation ID. Bind the subsequent load/soak evidence to the post-cutover source commit and runtime identity.

Do not disable the guard after cutover merely to skip a refusal. Keep the startup wrapper and its completed verification configuration for subsequent restarts. A planned second master rotation requires a separately reviewed path/receipt generation and another drained maintenance window. There is no automatic rollback: later transactions must be preserved and reconciled before any recovery cutover.

## Rollback rehearsal and preparation

Retain both the encrypted rollback checkpoint's backup decrypt key and the **old Core master secret**. Prepare a new rollback database; never restore over the live database:

```sh
node scripts/rotate-core-master.mjs rollback \
  /recovery/before-master-change.stbk \
  /recovery/rollback-ready.sqlite \
  --offline
```

This validates the checkpoint's deployment identity and old vault key, revokes restored control-panel authority, verifies preserved application data, and publishes another fresh file. It does not cut traffic over or start a second writer.

A checkpoint cannot know which OTPs or recovery codes were used later. Rollback therefore invalidates all restored recovery codes and advances the TOTP replay floor past the current acceptance window. Staff wait for a code later than that window (normally up to about a minute), sign in, and issue new recovery codes. TOTP secrets and individual passwords remain as recorded in the checkpoint.

A rollback snapshot represents its original checkpoint. Reverting after new accepted transactions requires reconciliation and preservation of those later transactions; replacing the current ledger with an older checkpoint would lose them. The automated rehearsal uses independent, temporary copies and verifies exact-once settlement of the same previously pending fixture round in each copy. It does not replay any real external wallet operation or claim a live rollback.

## Bounded retention

Set `BACKUP_RETENTION_ENABLED=true` to run the retention policy after a successful remotely downloaded and restored backup. Its default mode is `BACKUP_RETENTION_MODE=dry-run`; `apply` enables conditional deletion after every prerequisite passes. `BACKUP_RETENTION_MAX_DELETES` defaults to 5 and cannot exceed 10. `BACKUP_RESTORE_IN_PROGRESS_OBJECT` protects the exact archive used by a restore; an unknown restore scope blocks retention.

The policy retains the two newest owned archives, every archive younger than seven days, available daily representatives for seven UTC days, weekly representatives for four UTC weeks, monthly representatives for twelve UTC months, and the protected restore object. It only recognizes the current deployment's canonical STBK02 path pattern. Foreign prefixes, manual files, old-format names and unknown objects are preserved.

Each run inventories all pages, stops at 4,096 objects, detects pagination loops and duplicate entries, and refuses future-dated archive names. At most 32 selected archives are downloaded for verification. Before the first archive deletion it authenticates and restores the current archive, the two newest archives, retained older representatives, and every planned deletion candidate. It checks SQLite integrity, foreign keys, the exact deployment identity, the encrypted manifest, filename timestamp and checksum prefix. The current archive must match the just-uploaded full ciphertext checksum and be recent.

When apply mode has eligible candidates, a bounded capability probe creates a random disposable `.probe` object inside the same deployment prefix. It writes two distinct versions, requires the stale ETag delete to return 412, reads back the unchanged latest bytes and ETag, conditionally deletes that disposable object with the correct ETag, and verifies absence with HEAD 404. An endpoint that ignores conditions, lacks strong ETags, or produces an ambiguous result cannot authorize archive deletion. The probe is repeated for each deletion run; it never tests a conditional delete on an actual backup.

Set `BACKUP_RETENTION_PROBE=true` to obtain this capability evidence during qualification even in dry-run mode or when a new bucket has no aged candidates. This explicit option creates and removes only the disposable canary. Archive deletion still requires apply mode and all archive proofs.

All candidate proofs are obtained before deletion starts. Each archive delete includes its verified exact ETag, including that header in SigV4. Wildcard and weak/unsafe ETags are rejected. An object changed after verification is preserved; a delete failure stops further deletion and the receipt reports any earlier completed deletions. There is no unconditional-delete fallback.

The backup receipt reports retention separately: `verified`, `conditional_delete_verified`, the conditional capability probe result, eligible/deleted counts and a fixed error code. A successful dry-run or an apply run with zero candidates does not claim that deletion support was exercised unless the explicit probe ran and passed. A verified backup remains a verified backup when retention is blocked.

This is application-managed retention, not immutable or WORM storage. Railway's current documentation lists object versioning, object locks and bucket lifecycle configuration as unsupported. AWS documents exact-ETag `If-Match` deletion and 412 on mismatch; the runtime canary establishes the configured endpoint's observed behavior before using it.

Primary references:

- https://docs.railway.com/storage-buckets#s3-compatibility
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html

## Local verification

```sh
node --test --test-concurrency=1 \
  test/backup.test.mjs test/backup-keyring.test.mjs \
  test/core-key-rotation.test.mjs test/offsite-backup.test.mjs \
  test/backup-source.test.mjs test/provider-restore-drill.test.mjs \
  test/provider-retention.test.mjs
```

The tests cover retained STBK01 keys, STBK02 old/new keys, authenticated key-label tampering, corrupt ciphertext, private secret files, existing and symlinked destinations, original DB/WAL preservation, every current vault column, wrong master and wrong deployment rejection, new-key startup, staff MFA/replay preservation, panel-authority revocation, preserved operator/game/accounting state, pending-round exact-once settlement, and a verified rollback copy.

Retention tests use real encrypted SQLite archives and a deterministic S3 protocol fixture. They cover paginated inventory, protected unknown/foreign objects, deletion bounds, authenticated identity mismatch, corrupt/unavailable evidence, stale ETags, ignored conditional requests, the disposable canary, changed-candidate preservation and a zero-delete failure path. They do not claim a live Railway deletion occurred.
