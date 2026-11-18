# XDPLAY / Genesis finance integration readiness: 18 November 2026

## Verified configuration

- XDPLAY development is sample-only. Its operator records and finance invoices are isolated browser-session fixtures.
- XDPLAY Provider Core has authenticated virtual-credit transaction and reconciliation routes. This is not an authorization for real-money billing.
- Genesis Preproduction does not presently list the GENESIS_SOFTTECH_WALLETS or GENESIS_SOFTTECH_LAUNCHES variables. No external operator binding has been verified.
- Genesis v0.15 documentation distinguishes signed complete operator-journal statements from incomplete offset-based transaction API scans.

## Next integration checkpoints

1. Pin the exact Genesis tenant and dedicated XDPLAY sandbox operator and provider deployment ID. Provision operator credentials only in the protected system with MFA and independent staff review.
2. Configure Genesis server-only wallet and launch bindings with IDR, scale 0, trusted HTTPS origins, game URLs and signing credentials. Never commit secrets or expose credentials to the public development dashboard.
3. Execute native sandbox launch, debit, settlement, zero payout, reversal, failure/retry, restart and reconciliation tests.
4. Verify signed full provider journal using Genesis' documented statement-export contract. Record the manifest digest, snapshot cutoff, scope, matched status and any partial historical-balance evidence. The existing offset API is explicitly incomplete.
5. Build a read-only, tenant-scoped financial usage snapshot containing operator and tenant IDs, immutable deployment ID, period boundaries, settled count and timestamp, source contract version, signed evidence digest and coverage result. Commercial billable units and pricing must come from a separately approved contract, not from player stakes or losses.
6. Require completeness, independent finance approval, statutory invoice configuration, durable finance accounting, receipts and backup/recovery before a commercial invoice can be issued.

## Development-only guard now available

GET /api/finance/source-readiness reports not_connected and demo_only. POST/PATCH/PUT /api/finance/external-usage fail with EXTERNAL_USAGE_NOT_CONNECTED. DEMO invoices are explicitly tagged fixture, unverified and commercial=false.

This does not connect Genesis, issue real invoices, generate tax documents, move funds or grant production operator access.
