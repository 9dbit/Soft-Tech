# Soft Tech Provider v1.1: Offsite Backup and Operator Contract QA

Date: 2026-11-09. This checkpoint documents deployed source commit `de6973b21b68b2d9921106d10f74bc0177a738e8` (the branch may move after this commit).

## Scope
- Provider Core SQLite database only, not the separate UNO, Mahjong, or Skygate engine volumes.
- Railway bucket: `softtech-provider-backups`, region IAD, independent of the core volume in SFO.
- Runtime encrypted snapshot every 24 hours with an initial run ~30 seconds after boot.
- SQLite online backup API -> local integrity check -> AES-256-GCM encrypted .stbk -> local decrypt/restore verification -> signed S3 PUT -> signed S3 GET -> SHA-256 comparison -> isolated remote restore verification.
- Uses Railway bucket reference variables, not copied bucket credentials.
- Last status available to authenticated Administrator at GET /api/backup-status. Also logged as provider.offsite_backup.
- A successful local mock test is not proof of a remote restore. Verify the runtime log shows `remoteRestore: verified` and `ok:true`.

## Restore procedure
1. Freeze writes or choose an agreed point in time. Record transaction journal checkpoints.
2. Obtain the exact encrypted `.stbk` object from the offsite bucket with authorized credentials. Verify its SHA-256 against the logged checksum.
3. In an isolated, access-controlled recovery environment, retrieve the independently retained `BACKUP_PASSPHRASE` from the secret manager.
4. Run `BACKUP_PASSPHRASE=... node scripts/sqlite-backup.mjs restore SOURCE.stbk /new/restore/provider.sqlite` with the password supplied as an environment variable, not a command-line argument. Never restore over an existing file.
5. Validate SQLite integrity, core schema, ledger journal, operator records, and a signed sandbox API call.
6. Preserve `PANEL_SESSION_SECRET` separately: it is required to decrypt operator API secrets in restored data. Rotating it without key migration breaks operator access.
7. Do not replace production volume until the user has approved a recovery cutover and the journal is reconciled.

## Conformance QA
- `test/operator-http.test.mjs` boots a real isolated HTTP provider with a temporary database.
- Creates two operators via authenticated admin API.
- Signs requests independently using the documented softtech.v1 canonical format.
- Verifies three-game listing, signed game launch, duplicate idempotency key, replay nonce rejection, and cross-operator session isolation.
- This is an internal contract test, not certification of any external operator's real wallet.

## Remaining gates
- Engine volumes (UNO, Mahjong, Skygate) require separate per-service backup and recovery integration; not covered by this release.
- Set retention/lifecycle policy, restore drill in a dedicated recovery environment, alerts on backup failure and missing daily backup.
- Individual staff identities, MFA, external wallet conformance, live Safari/iPhone browser tests, load testing and release approval controls remain pending.
- No production real-money capability is enabled. Marketing website UI remains untouched.
