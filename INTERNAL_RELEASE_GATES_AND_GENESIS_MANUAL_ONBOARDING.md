# Soft Tech: internal release gates and manual Genesis operator onboarding
Updated: 2026-11-10. Scope: Soft Tech provider only. Genesis is a future independent operator, not connected or modified by this document.

## Verified evidence
- Latest Railway deployments of UNO, Mahjong, Skygate: SUCCESS, from environment named production; this is **not** a production-mode release.
- GitHub Actions native backup tests: PASS for all three engines.
- Skygate live deploy log: `[ENGINE BACKUP] verified` after encrypted upload, readback, isolated restore and integrity check.
- UNO/Mahjong live deploy logs: backup worker launch only. **No verified remote restore event.**
- Core `advanceRelease` blocks preproduction activation with `PREPRODUCTION_ISOLATION_PENDING`. Do not bypass this protection.
- No external operator certification, production segregation, MFA or measured load/chaos evidence is presently established.

## Internal confidence gates (all mandatory)
| Gate | Required proof | Current |
| --- | --- | --- |
| G01 | Each game backup stored in S3, read back, decrypted and restored in isolated scratch SQLite, with immutable manifest and timestamp | Skygate PASS; UNO/Mahjong UNKNOWN |
| G02 | Restore rehearsal after simulated lost volume, preserving key and RPO/RTO targets | NOT TESTED |
| G03 | Backup age alert, retention policy, rotation, and restore drill | NOT TESTED |
| G04 | Sandbox, preproduction, production physically separate DB/volume, wallet endpoints, API keys, secrets and session stores | NOT VERIFIED |
| G05 | Admin MFA, session revocation, rate limiting, scoped RBAC, independent approvals, audit trail | NOT VERIFIED |
| G06 | Signed HMAC API negative tests: invalid signature, replay, stale timestamp, cross-tenant, duplicate idempotency, wrong currency, malformed payload | PARTIAL TEST COVERAGE |
| G07 | Wallet debit, settle, refund, timeout, ambiguous result, duplicate callback, recovery and exactly-once ledger semantics with simulated operator | NOT CERTIFIED |
| G08 | Native game deterministic result/ledger reconciliation, seed/RNG review and per-game correctness | NOT CERTIFIED |
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
