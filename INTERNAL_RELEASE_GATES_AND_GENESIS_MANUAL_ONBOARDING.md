# Soft Tech: internal release gates and manual Genesis operator onboarding
Updated: 2026-11-10. Scope: Soft Tech provider only. Genesis is a future independent operator, not connected or modified by this document.

## Verified evidence
- Provider Core, UNO, Mahjong and Skygate: new deployments SUCCESS with application mode sandbox. Exact commits/deployment IDs are in [the 10 November checkpoint](CHECKPOINT_2026-11-10_BACKUP_RECOVERY_AND_MONITORING.md); Railway's environment name production is **not** a production-mode release.
- GitHub Actions provider suite: 53 tests PASS; native backup/status suites: UNO 16, Mahjong 16, Skygate 6 PASS.
- All three native live deploy logs now contain `engine.backup.remote_verified` after encrypted upload, readback, authenticated decryption and isolated SQLite integrity checks. Provider Core records `remoteRestore:verified`.
- All four `/health/backup` endpoints return 200 with fresh proof bound to their current full source commit. The first hourly-monitor workflow execution [42685664119](https://github.com/9dbit/Soft-Tech/actions/runs/42685664119) passed on default branch main.
- Fresh deployed acceptance `provider-20261110-backup-isolation-01` passed six actual native-game cases across two internal sandbox operators, including duplicate callbacks, tenant isolation and ledger reconciliation.
- A local provider application restore rehearsal preserves identity, credentials, sessions, replay protection and journal state; pending settlement completes once. It does not establish native lost-volume recovery or production RPO/RTO.
- Core `advanceRelease` blocks preproduction activation with `PREPRODUCTION_ISOLATION_PENDING`. Do not bypass this protection.
- Immutable sandbox database identity and real-path volume containment are deployed. Physical preproduction/production segregation, external operator certification, MFA and measured load/chaos evidence are still not established.

## Internal confidence gates (all mandatory)
| Gate | Required proof | Current |
| --- | --- | --- |
| G01 | Each game backup stored in S3, read back, decrypted and restored in isolated scratch SQLite, with immutable manifest and timestamp | Remote snapshot/readback/restore PASS for all three; checksum/authenticated manifest and timestamp recorded. Storage immutability policy is not yet verified |
| G02 | Restore rehearsal after simulated lost volume, preserving key and RPO/RTO targets | PARTIAL: provider application fixture PASS; full native volume-loss drill and production targets NOT VERIFIED |
| G03 | Backup age alert, retention policy, rotation, and restore drill | PARTIAL: hourly current-build/freshness monitoring and failure retries active; S3 retention, key rotation and alert delivery drill pending |
| G04 | Sandbox, preproduction, production physically separate DB/volume, wallet endpoints, API keys, secrets and session stores | PARTIAL CODE SAFEGUARD: immutable sandbox identity/path checks deployed; physical separation NOT VERIFIED |
| G05 | Admin MFA, session revocation, rate limiting, scoped RBAC, independent approvals, audit trail | NOT VERIFIED |
| G06 | Signed HMAC API negative tests: invalid signature, replay, stale timestamp, cross-tenant, duplicate idempotency, wrong currency, malformed payload | PARTIAL TEST COVERAGE |
| G07 | Wallet debit, settle, refund, timeout, ambiguous result, duplicate callback, recovery and exactly-once ledger semantics with simulated operator | Internal fault tests and six live sandbox rounds PASS; external wallet NOT CERTIFIED |
| G08 | Native game deterministic result/ledger reconciliation, seed/RNG review and per-game correctness | Live sandbox reconciliation PASS; full math/RNG review NOT CERTIFIED |
| G09 | Load 500/1000 concurrent sessions, soak, crash/restart, latency, error rate and resource ceilings | NOT TESTED |
| G10 | Independent security review, dependency/secret scan, backup access, incident response, rollback drill | NOT VERIFIED |
| G11 | Applicable jurisdiction/operator compliance, terms and documented go-live signoff | EXTERNAL DECISION |

Never assign a numeric confidence percentage until evidence exists. Treat UNKNOWN as FAIL-CLOSED.

## Operator-neutral contract to prepare
Soft Tech is a provider. Genesis must implement the operator wallet and authentication adapters independently. No provider code may depend on Genesis-specific field names or URLs.

1. Operator registration: unique operator ID, permitted games, currency, callback base URL, allowed return origins, isolated credentials.
2. Provider issues scoped API key and secret to Genesis through a secure channel; never paste credentials into frontend code or GitHub.
3. Genesis server signs requests to Soft Tech using the exact canonical HMAC contract in the API Developer page. Include timestamp, nonce, idempotency key; use HTTPS.
4. Genesis provides server-side balance, debit/reserve, settle/credit, reversal, and transaction-status endpoints matching the wallet contract. Every action has a durable unique reference and immutable transaction journal.
5. Soft Tech creates a game launch/session for an authenticated Genesis player. Genesis does not generate game results; Soft Tech does not directly modify Genesis balances.
6. All callbacks must be signed, retry-safe, replay-protected, operator-scoped and reconciled daily.
7. Test cases: normal round; insufficient funds; expired session; duplicate debit; duplicate settlement; delayed callback; failed reversal; process crash after debit; wrong operator; invalid signature; timeout; network partition; reconciliation mismatch.
8. Only after all internal gates and Genesis sandbox conformance PASS, submit independent preproduction approval. Keep production disabled until final signoff.

## Manual Genesis integration sequence (after internal signoff)
A. Open Soft Tech Master Panel > Operators and create `Genesis` in SANDBOX, with only approved game IDs and currency.
B. Record Genesis sandbox API base URL, callback URL and return origins. Do not use a public production wallet URL.
C. Generate scoped credentials in Soft Tech. Copy once to Genesis backend secret store; never embed in browser.
D. Implement Genesis wallet adapter using Soft Tech API Developer contract, including HMAC, nonce, idempotency, balance/debit/credit/reversal/status.
E. Perform sandbox conformance suite and export signed evidence plus reconciliation.
F. Validate each game independently, then request preproduction activation through Release Control only after physical isolation and approvals.
G. Production go-live is a separate manual, audited decision. Start with a restricted pilot and rollback plan.

## STOP conditions
Missing backup verification, mismatched ledger, duplicate settlement, secret exposure, insufficient legal clearance, unverified isolation or failed load/security test must prevent production unlock.
