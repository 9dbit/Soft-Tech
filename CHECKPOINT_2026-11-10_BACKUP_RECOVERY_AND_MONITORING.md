# Soft Tech: backup recovery and monitoring continuation

Verified 10 November 2026 WIB (9 November UTC). This checkpoint continues the independent provider branch from `c6d3038` and supersedes the earlier UNKNOWN status of UNO/Mahjong remote backups. All application traffic remains sandbox virtual credits. Production activation remains locked.

## Deployed and verified

| Component | Running source commit | Railway deployment | Health and backup proof |
| --- | --- | --- | --- |
| Provider Core | `35275b061dbfc08f446dea29a11cb2b1389b05aa` | `b977f702-66b5-4839-870f-b95a791bc76a` | SUCCESS; both endpoints 200; remote restore verified |
| UNO LUCK | `e9a41318ae7f2f6f643a1bff36349b839e3894cd` | `77cc457a-bcc0-41fa-8cec-bc615783e570` | SUCCESS; both endpoints 200; remote restore verified |
| Mahjong Wild | `a32b33f85a3585349f1edc917ab75befd17de0af` | `411c7d30-73fa-4e54-ad58-b19112bbff06` | SUCCESS; both endpoints 200; remote restore verified |
| Skygate 5000 | `9f04ab6d73ff4f6fff742b8b275fa6cdb214d33d` | `3207f8ea-a6c2-4e06-998b-465eabda0800` | SUCCESS; both endpoints 200; remote restore verified |

Each `/health/backup` response names the exact same source commit as its service's `/health`. The evidence timestamps are later than the respective new process startups. The local live verifier finished at `2026-11-09T19:40:08.449338+00:00` with all four services passing on the first attempt.

Machine-readable evidence:

- [Live health and backup probe](evidence/provider-health-2026-11-10.json)
- [Deployments, backup events, CI and scope](evidence/provider-rollout-2026-11-10.json)

## Corrections shipped

1. **Provider CI startup failure.** The HTTP test spawned the server with a working directory relative to the caller. `npm test` therefore attempted the nonexistent nested directory `provider-dashboard/provider-dashboard`. The test now resolves its server directory relative to its own module and reports child spawn errors. Both workflow invocation paths pass; no assertion or test was removed.
2. **Stale source overwrite risk.** The provider release workflow now validates checked-in source using read-only permissions. It no longer materializes an old compressed source archive or commits/pushes over subsequent fixes.
3. **UNO/Mahjong S3 backup failure.** Railway's `virtual-host` spelling is normalized to botocore's `virtual`. Valid styles remain supported; invalid styles fail before snapshot or network work. Fresh live logs now show `engine.backup.remote_verified`.
4. **Backup health on all four services.** Public endpoints reveal only status, proof time and source commit. Missing, failed, malformed, stale, future or different-build evidence fails closed. Native proof files are atomically replaced. The default freshness ceiling is 25 hours for the deployed daily backup cadence.
5. **Retry behavior.** Provider and Skygate use serialized scheduling with five-minute retries after failure and the configured cadence after success. UNO/Mahjong retain their five-minute failure retry. Retry does not skip remote readback, authenticated decryption or isolated integrity checks.
6. **Database identity and path safety.** Core persists an immutable sandbox identity and rejects a different explicit deployment ID or a request to relabel the database. Actual filesystem paths must remain inside the mounted volume. The live identity is explicitly configured as service `c19f2aa0-8508-430f-a21c-0d3ac1be87bc`.
7. **Backup source correctness.** A review reproduced an ambiguous symlink/parent path selecting a different SQLite file for backup. Core now exposes its validated canonical database path and the backup runner uses that same path. A regression restores the real Core identity, session and journal rather than the unrelated database fixture.

## Validation evidence

| Validation | Result | Evidence |
| --- | --- | --- |
| Provider unit/integration/security/restore suite | 53 passed, zero skipped | [Integration CI](https://github.com/9dbit/Soft-Tech/actions/runs/42685068736) |
| Provider backup and full regression workflow | PASS | [Backup CI](https://github.com/9dbit/Soft-Tech/actions/runs/42685068336) |
| UNO backup and status tests | 16 passed | [UNO CI](https://github.com/9dbit/uno-luck/actions/runs/42684550424) |
| Mahjong backup and status tests | 16 passed | [Mahjong CI](https://github.com/9dbit/Mahjong-legend/actions/runs/42684624769) |
| Skygate backup and status tests | 6 passed | [Skygate CI](https://github.com/9dbit/Skygate/actions/runs/42684766184) |
| Monitor verifier fixture tests | 9 passed locally | Workflow validation; local fixtures do not establish remote health |
| Responsive provider dashboard | Desktop/mobile/admin/auditor checks PASS | Included in provider integration CI |
| Actual deployed engine acceptance | 6 cases passed | Run `provider-20261110-backup-isolation-01`; runtime event at `2026-11-09T19:39:37.767879724Z` |

The six live cases use two internal sandbox operators and all three native games. They verify launch, actual game completion, duplicate request stability, one debit and one settlement per round, cross-operator read denial and journal reconciliation. They do not certify an external operator wallet.

The application restore rehearsal uses an encrypted snapshot of committed WAL data with one settled and one reserved round. Restored credentials, nonce history, sessions and idempotency survive. Replaying the completed settlement adds no journal entry; concurrent completion of the pending round adds exactly one credit. The original database remains unchanged. This is a local fixture rehearsal, not a Railway volume-loss drill or measured production RPO/RTO.

## Hourly monitoring

The complete monitor is installed on default branch `main` at `247c0ce30033c531a4982ef84abaf62272b0236e`. GitHub schedule `17 * * * *` checks the provider and all three engines using bounded, read-only HTTPS probes. Each service must have matching runtime/backup source commits and fresh proof. A JSON artifact is retained for 14 days, including failed runs. Manual dispatch and a workflow-file push trigger are also configured.

The first actual GitHub execution [42685664119](https://github.com/9dbit/Soft-Tech/actions/runs/42685664119) completed **SUCCESS** for all four services. This is operational monitoring evidence in addition to the local live probe.

The old feature-branch-only schedule was not sufficient to activate GitHub scheduled runs. The monitor must stay on default `main`; maintaining only the provider-branch copy does not establish an active schedule. Artifact retention is distinct from S3 backup retention.

## Remaining production gates

- Physical sandbox/preproduction/production service, volume, wallet, secret and session separation; environment/audience-bound native and operator protocols. Current identity safeguards are preparation only; runtime reports `physical_isolation_verified:false`.
- Named staff identities, MFA, scoped administration, session revocation and independent release approvals.
- External wallet certification with failure/retry/recovery evidence. Genesis remains a future independent operator; Playground is a separate operator system.
- Full native lost-volume recovery with independently recovered secrets/assets, measured RPO/RTO, S3 retention/key rotation, incident alert delivery and rollback rehearsal.
- Engine math/RNG review and reproducible per-game reconciliation certification.
- 500/1000 real-session load, soak, restart, network partition and resource-ceiling tests.
- Independent security review and applicable go-live/legal signoff.

Do not remove `PREPRODUCTION_ISOLATION_PENDING`, switch wallet semantics, or mark production ready based on these successful deployments. `production_enabled` remains false.
