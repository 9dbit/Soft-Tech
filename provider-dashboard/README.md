# Soft Tech Independent Provider Core v1

A real, operator-neutral sandbox control plane for UNO LUCK, MAHJONG WILD and SKYGATE 5000. The approved six-page dashboard design is retained. Runtime statistics come from the provider database, not hard-coded sample records.

## Boundaries
- Isolated provider engine services preserve original public services and immutable game math.
- Server-authoritative native engines persist outcomes before reserve/settlement requests.
- Virtual, non-purchasable and non-redeemable sandbox credits only. No real-money enablement, deposits or withdrawals.
- Master controls include game registry, actual engine health, Test Play, maintenance, scoped operator onboarding/key rotation, sessions, rounds, immutable journal, reconciliation and API downloads.
- The existing game Studios remain separate. Master-panel visual/math release editing and promotion are not implemented in this release. Do not imply otherwise.
- SQLite WAL/FULL is a deliberate first-release single-replica design. Migrate the transactional store and distributed locking before horizontal scaling. A PostgreSQL cluster is not provisioned by this release.

## Required runtime configuration
- Node.js 24+
- PANEL_ADMIN_PASSWORD, PANEL_AUDITOR_PASSWORD: existing server-side access passwords, 16+ characters.
- PANEL_SESSION_SECRET: persistent encryption root (32+ characters). Keep a recoverable copy in a secret manager. Changing it without key migration makes stored operator secrets unreadable.
- CORE_DB_PATH=/data/provider.sqlite, with an attached Railway /data volume. Production refuses unmounted storage.
- CORE_ENVIRONMENT=sandbox and CORE_DEPLOYMENT_ID: a stable, nonsecret deployment identifier. The live provider uses its Railway service ID. The database permanently retains this identity; an explicit mismatch or a request to relabel it as preproduction/production fails before business writes. Resolved database paths must remain inside the mounted volume, including symlinks. This does not certify physical environment isolation or change the sandbox v1 signing protocol.
- CORE_PUBLIC_ORIGIN: panel's HTTPS origin.
- UNO_PROVIDER_ORIGIN, MAHJONG_PROVIDER_ORIGIN, SKYGATE_PROVIDER_ORIGIN: dedicated native engine HTTPS origins.
- CORE_ENGINE_KEYS_JSON: array of three objects with id, canonical game ID and independently generated secret. Never expose in browser or repository.
- CORE_ACCEPTANCE_RUN (optional): a new non-secret identifier runs six actual native rounds across two isolated internal operators, records the result, and never repeats the same identifier.

## Operator API
Download the exact OpenAPI v3.1 schema, HTML developer guide and Node signing example from API Developer. Request credentials are displayed once when creating/rotating an operator key. Operator accounts are distinguished from administrator panel sessions.

HMAC headers: X-SoftTech-Key, X-SoftTech-Timestamp, X-SoftTech-Nonce, X-SoftTech-Signature. Sign exact bytes of the body, method, path and query using the documented softtech.v1 format. Five-minute timestamp window and persistent replay-nonce rejection. Use a fresh nonce for every HTTP retry and preserve the Idempotency-Key and business body.

Implemented endpoints: /v1/games, /v1/game-launches, /v1/sessions, /v1/sessions/{id}, /v1/sessions/{id}/revoke, /v1/rounds/{id}, /v1/transactions, /v1/reconciliation, /v1/openapi.json.

## Wallets
Sandbox wallet grants configured free virtual opening credits once per operator/player/currency. Seamless sandbox mode calls a conforming external operator wallet base plus /balance, /debit, /credit, /status and /reversal. Callback requests are signed with a separate per-operator secret. Responses must match transaction ID, amount, currency and scale.

All transaction amounts use canonical integer strings. No cross-currency totals. Callback HTTPS hosts are DNS-resolved, validated against private/internal ranges, then pinned to prevent DNS rebinding. Redirects are forbidden. A timeout means an unknown result, never an automatic refund. Recovery queries transaction status before retrying the same transaction. Reversal and payout intents are mutually exclusive.

## Internal engine contract
Existing native adapters use the server-only /api/v4/agency-game/{redeem,status,reserve,settle,void} compatibility surface. The path naming is retained for adapter stability, not an operator dependency. Keys are independently scoped to one game and are not interchangeable with operator API credentials. All requests go to Soft Tech Core; no other operator platform is required or changed.

## Durability and operations
- One core instance and one instance per native engine; each has its own persistent volume.
- Keep services awake while pending rounds/recovery work exist. This deployment disables app sleep for provider runtimes.
- Ledger and audit rows are immutable; no reset/erase endpoint.
- Maintenance and operator disable block new admission while allowing already accepted rounds to settle.
- Health endpoints alone do not prove integration. The panel distinguishes health timestamps from verified signed engine calls. Acceptance additionally proves real settled rounds and journal matches.
- Encrypted offsite snapshots include upload, remote readback, authenticated decryption and isolated SQLite integrity verification. Configure OFFSITE_BACKUP_ENABLED, BACKUP_PASSPHRASE, BACKUP_S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/URL_STYLE and BACKUP_VERIFY_REMOTE=true. Keep encryption roots independently recoverable.
- The default backup cadence is 24 hours, with the initial attempt 30 seconds after startup. Failed attempts retry after five minutes without overlapping runs; OFFSITE_BACKUP_RETRY_SECONDS accepts 60–3600 seconds.
- GET /health verifies the running database. GET /health/backup separately returns 200 only for fresh remote-restore proof from the current source commit, otherwise 503. Its response contains no bucket credentials, object keys or raw error details. Release Control uses the same check. A cached proof is not a fresh S3 probe, and a verified database snapshot is not a full service or lost-volume recovery rehearsal.
- Restore into a new path, retain the original deployment identity and master secret, and verify journal reconciliation before a recovery cutover. Never delete or edit identity to repurpose a sandbox database.
- Browser test viewport emulation is not a physical iPhone Safari test.

## Tests
`npm test` runs isolated signing, replay, tenant isolation, launch retry, timeout recovery, currency precision, idempotency, immutable journal, maintenance, API auth and CSRF tests.
`python test/browser.py` runs Chromium control-panel checks against the real local core.
`test/acceptance.mjs` runs opt-in real-engine acceptance after deployment, using only internal sandbox operators and virtual credits; no RNG overrides or fabricated rounds.
