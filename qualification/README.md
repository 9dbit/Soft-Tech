# Wallet and native-session qualification

This package provides internal engineering evidence for Soft Tech. The reference wallet is a separately deployed test operator with its own database, journal, secrets and audience binding. It is not Genesis, Playground, an external certification authority or a real-money wallet. A report from this service cannot satisfy `wallet_external_operator`, independent security/math review or legal signoff.

## Deployment

Build `reference-wallet/Dockerfile` with the repository root as build context. Runtime is Node24; there are no package dependencies. Attach one dedicated persistent `/data` volume. Use one replica because the wallet uses local SQLite WAL with synchronous FULL transactions. Its HTTP health endpoint is `/health`.

Every environment needs distinct values for `WALLET_MASTER_KEY` (at least32 characters), `WALLET_ADMIN_TOKEN` (at least40), database volume and `WALLET_DEPLOYMENT_ID`. Set:

| Variable | Purpose |
| --- | --- |
| `WALLET_ENVIRONMENT` | Exact `sandbox`, `preproduction` or `production` identity |
| `WALLET_DEPLOYMENT_ID` | This wallet's immutable service/deployment identity |
| `WALLET_CORE_AUDIENCE` | The one Core service authorized to sign wallet calls |
| `WALLET_DB_PATH` | `/data/wallet.sqlite` |
| `WALLET_TEST_CONTROL_ENABLED` | `true` only in isolated sandbox/preproduction |
| `WALLET_MASTER_KEY` | Server-only encryption secret for wallet credentials |
| `WALLET_ADMIN_TOKEN` | Separate secret for machine-operated test preparation |
| `PORT` | `8080` |

Production starts quarantined. Financial operations and operator registration return423. Test controls are forbidden. No environment variable enables production financial operations in this reference wallet.

An existing database cannot be relabelled to another environment, wallet ID, Core audience or encryption master. SQLite identity, ledger, receipts and audit have immutable triggers including replacement protection. API credentials are AES256GCM encrypted in the wallet database. Test account seeds are immutable and idempotent: calling the seed endpoint again never resets a played balance.

The Core helper `provider-dashboard/lib/qualification-bootstrap.mjs` creates only an internal, virtual-credit qualification operator. It requires the reserved `op_qualification_` ID prefix, v2 credentials, exact audience, an explicit `CORE_QUALIFICATION_WALLET_ORIGINS` allowlist, VCOIN/scale2 and distinct credentials. Restart verifies the existing configuration and wallet identity. The helper never creates staff identities or signs release approvals.

## Wallet protocol

Wallet paths are `/wallet/balance`, `/wallet/debit`, `/wallet/credit`, `/wallet/reversal` and `/wallet/status`, with POST and an exact JSON request body. Monetary values are canonical nonnegative integer strings in minor units. Float amounts, wrong currency/scale, cross-operator payloads and duplicate transaction IDs with changed content are rejected.

HMAC-SHA256 v2 canonical bytes are these UTF8 lines, joined by one LF with no trailing LF:

```
softtech.wallet.v2
<environment>
<Core deployment ID>
POST
<exact path>
<Unix timestamp seconds>
<nonce>
<lowercase SHA256 of exact request bytes>
```

Send `X-SoftTech-Key: wallet-<operator_id>`, timestamp, nonce and signature through `X-SoftTech-Timestamp`, `X-SoftTech-Nonce` and `X-SoftTech-Signature`. Add `X-Wallet-Version: 2`, `X-Wallet-Environment` and `X-Wallet-Audience`. The wallet enforces the configured environment and Core audience, a five-minute timestamp window and durable nonce uniqueness. Nonces older than ten minutes can be pruned; a request that old is outside the signature acceptance window. Version1 exists only for an explicitly configured sandbox operator.

Debit, credit and reversal commit the authoritative balance change, immutable receipt and journal entry in one SQLite transaction. A retry returns the original receipt. `status` returns `applied`, `rejected` or `not_found` without moving funds. Reversal requires the exact original debit and amount. A credited round cannot be reversed; a reversed round cannot be credited. Credit requires an applied debit for the same player and round. A second transaction ID cannot repeat the same round action.

Authenticated machine control uses `Authorization: Bearer <WALLET_ADMIN_TOKEN>`:

| Endpoint | Operation |
| --- | --- |
| `POST /admin/operators` | Register exact operator/currency/scale/protocol/secret; identical retry succeeds, changed configuration409 |
| `POST /admin/accounts` | Seed a new synthetic player; identical repeat does not reset balance |
| `POST /admin/faults` | Arm a bounded fault for an operator/action, only when test controls are enabled |
| `POST /admin/faults/clear` | Disable remaining armed faults for the operator |
| `POST /admin/report` | Page authoritative receipts/accounts and retrieve reconciliation/fault-consumption proof |

Faults include disconnect before/after commit, timeout before/after commit, rejection, pending response and simulated network partition. Fault creation is authenticated, limited in count/duration, and audited. It is not available in production.

## Protected harness configuration

Copy `config.example.json` to a private path outside the repository, replace its values from the protected environment configuration and set mode0600. Do not commit the completed file. The harness refuses production and rejects a credential file readable by other users. HTTPS is required, except an explicitly enabled local fixture. The wallet URL is the wallet **origin**, without `/wallet`.

The harness never writes signing secrets, launch tokens or session cookies into reports. Reports contain service identities, commits, run IDs, opaque session/round IDs, timing, status counts and reconciliation results.

## Execute the tests

Unit/integration safeguards run with:

```bash
node --test --test-concurrency=1 reference-wallet/test/*.test.mjs qualification/test/*.test.mjs
```

The CI workflow is `.github/workflows/provider-qualification.yml`. It has read-only repository permission, does not persist checkout credentials and uses no deployment secrets.

Live wallet conformance:

```bash
node qualification/wallet-conformance.mjs \
  --config /private/preproduction.json \
  --run-id wallet-preproduction-01 \
  --report evidence/wallet-preproduction-01.json
```

The CLI deliberately reports PARTIAL when no actual deployment restart hook is supplied. The exported `runWalletConformance` accepts a restart callback for a real platform restart or a disposable local fixture. Its17 scenarios cover seed authorization/idempotency, balances, debit/credit/refund, insufficient funds, conflicting retry, double close, signature/replay/timestamp/audience/environment, cross-operator/currency, ambiguous disconnect/timeout, pending status, partition, durable rejection, restart and authoritative ledger reconciliation.

Run a small preparatory smoke test only by explicitly setting `allow_small_test: true` in the protected configuration. A small smoke test is never500/1,000-session evidence. The required load runs are:

```bash
node qualification/native-load.mjs \
  --config /private/preproduction.json \
  --sessions 500 --rounds 1 --setup-concurrency 40 \
  --run-id load-500-01 --report evidence/load-500-01.json

node qualification/native-load.mjs \
  --config /private/preproduction.json \
  --sessions 1000 --rounds 1 --setup-concurrency 40 \
  --run-id load-1000-01 --report evidence/load-1000-01.json

node qualification/native-load.mjs \
  --config /private/preproduction.json \
  --sessions 500 --duration-seconds 1800 --min-soak-seconds 1800 \
  --think-time-ms 1000 --setup-concurrency 40 \
  --run-id soak-30m-01 --report evidence/soak-30m-01.json
```

Each virtual user receives a separate operator launch, redeems a real native session and maintains its own cookie. The barrier must contain the full requested session count before gameplay begins. UNO executes its real three-phase pick, Mahjong its real spin and Skygate its real spin. Each completed round is replayed with the same native idempotency key and must return the same result. Engine RNG is not overridden. These are real authenticated HTTP game sessions, not500/1,000 human users or browser-rendering instances.

Latency includes p50/p95/p99, per-operation timings, complete native-round time, request errors and maximum simultaneously outstanding HTTP requests. Up to100,000 overall/round samples and10,000 per-operation samples are retained. Results identify exact quantiles versus uniform-reservoir estimates. Counters and errors remain exact. The sampler has no relationship to engine RNG.

Every session in the run must play successfully; duplicate outcomes and all provider/wallet ledger pairs must match. Reconciliation pages all run records into temporary SQLite, detects missing acknowledgements/orphan applied wallet entries, and does not substitute Core's latest1,000-round summary for complete run verification. Temporary reconciliation data is removed after the proof is produced. After the run, sessions are revoked while accepted financial work remains settleable.

Default acceptance thresholds are request error rate<=1% and round p95<=10seconds. All sessions must complete with no round failure. A failed threshold remains FAIL. Server CPU/memory ceilings remain PARTIAL until authoritative Railway measurements for the report's exact timestamps are attached. Client-process RSS is never reported as server memory evidence. Set a resource budget before the load run; do not raise a threshold merely to pass a failed run.

Do not run another mutation-heavy qualification against the same operator during final paginated reconciliation. Use a distinct internal operator per concurrent run if parallel reconciliation is needed.

## Network and restart exercise

```bash
node qualification/native-chaos.mjs \
  --config /private/preproduction.json \
  --run-id chaos-preproduction-01 \
  --control-file /private/chaos-control.json \
  --report evidence/chaos-preproduction-01.json
```

The runner plays all three engines, injects wallet network partitions and ambiguous credit acknowledgement, and requests real platform restarts of Core, wallet, UNO, Mahjong and Skygate. The control file includes one unique request ID, target name, environment, Core audience, source SHA and previous process boot ID. The platform operator must restart only that isolated service, then write `<control-file>.ack.json`:

```json
{
  "request_id": "EXACT_REQUEST_ID_FROM_CONTROL_FILE",
  "target": "EXACT_TARGET_FROM_CONTROL_FILE",
  "status": "RESTART_REQUESTED",
  "operation_id": "ACTUAL_PLATFORM_OPERATION_REFERENCE",
  "requested_at": "ACTUAL_TIMESTAMP_WITH_TIMEZONE"
}
```

Acknowledgement alone never passes the test. The runner observes a changed random process boot ID and unchanged deployment identity/source, reuses the same native session, retries exact requests and reconciles all journals. Reports distinguish a restart during native retry from a restart after transparent native recovery. Missing acknowledgement or missing process change fails after the bounded deadline. This tests service restarts; full native volume-loss recovery is a separate drill.

## Signed go-live evidence

`evidence-gate.mjs` supersedes reliance on a document merely saying PASS. It does not activate production. The actual human release workflow and platform controls remain separate.

Twenty engineering, operator, security, mathematics and legal requirements are checked. Every signed attestation binds the exact production deployment and full Core/UNO/Mahjong/Skygate/wallet commits; dated material files have verified byte counts and SHA256 hashes. Ed25519 reviewer signatures must be trusted through an independently managed identity registry. Unknown, revoked, expired, wrong-role and automation-as-human identities are rejected. Independent reviewers cannot also be the implementation reviewer or release requester. An internally operated reference wallet cannot satisfy external operator certification.

The final requester and approver must be different verified human identities. Both approvals bind the complete attestation-set hash and the same release ID. Changing any attestation invalidates their approval. A key, a signature or a green automated test alone is not proof that a real person independently reviewed the evidence; reviewer identity verification must occur before their key enters the trusted registry.

`reviewer-registry.example.json` intentionally contains no trusted keys. `release-bundle.template.json` intentionally contains no attestations. They fail closed. The actual reviewer can sign a completed payload using:

```bash
node qualification/sign-attestation.mjs \
  --registry /private/trusted-reviewers.json \
  --key-id ACTUAL_REVIEWER_KEY_ID \
  --private-key /private/reviewer-ed25519.pem \
  --payload review/completed-attestation.json \
  --output review/signed-attestation.json
```

The private key must be mode0600 and match the already trusted public key. The tool does not generate identities, grant roles or sign an incomplete/failed review. An attestation payload contains `schema_version:1`, `gate`, `status:"PASS"`, exact `target`, timezone-aware `verified_at`/`expires_at`, and one or more `materials` with relative path, SHA256 and byte size. External-wallet proof additionally needs `classification:"external_operator_conformance"` and an actual external operator ID. Load/soak proof needs `classification:"real_native_session_http_load"`.

Final request/approve payloads use `gate:"go_live_request"` or `"go_live_approve"`, the same `release_id`, and `evidence_set_sha256` equal to SHA256 of the canonical sorted-key JSON attestation array. Approval also identifies the verified `requester_person_id`.

Verification is read-only:

```bash
node qualification/evidence-gate.mjs \
  --bundle review/release-bundle.json \
  --registry /private/trusted-reviewers.json \
  --target review/expected-production-target.json \
  --evidence-root review \
  --report evidence/go-live-verification.json
```

Any missing real external wallet evidence, independent review, legal decision, actual MFA enrollment or distinct-person approval keeps `ready:false`. No test fixture should be included as release evidence. Unit test fixtures that sign every gate exist only to verify the verifier and are labelled accordingly.

## Dedicated preproduction runner

A client outside the platform can add transport delays unrelated to application work. Retain that end-to-end report, including failed latency criteria. The dedicated runner provides a separate measurement from a service inside the preproduction project, using the same public HTTPS APIs, real sessions, native RNG, wallet callbacks and ledger verification. It does not change thresholds or relabel an external failure as success.

Build `qualification/Dockerfile` with repository-root context. Attach a separate `/data` volume, use one replica, set `QUALIFICATION_RUNNER_ID` to the runner service ID, and supply the protected configuration as `QUALIFICATION_CONFIG_JSON`. `RUNNER_READ_TOKEN` is a distinct random secret of at least40 characters. Railway supplies the full source SHA. The runner refuses production configuration or a missing Railway volume. Its volume has immutable deployment/audience identity checks.

Leave `QUALIFICATION_RUN_ID` unset on the initial deployment. `/health` will show `IDLE`; no test traffic starts. A configured run ID starts exactly one of these fixed plans:

| `QUALIFICATION_PLAN` | Fixed work |
| --- | --- |
| `standard` (default) |500 sessions, then1,000 sessions, then60-minute soak |
| `baseline500` |500 sessions only |
| `wallet_conformance` |17 deployed reference-wallet conformance cases, including an actual wallet restart |
| `network_restart` |12 native network/restart cases, with actual Core, wallet and three native process restarts |

The standard soak uses500 concurrent sessions by default; set `QUALIFICATION_SOAK_SESSIONS=1000` explicitly for1,000. It always runs a full3,600seconds. A failed functional or latency gate stops the plan before its next step. A load report can remain PARTIAL only because independently attached platform resource measurements are still required.

`QUALIFICATION_EXPECTED_SOURCES_JSON` may pin all five target source commits with keys `core`, `wallet`, `uno`, `mahjong` and `skygate`. The runner validates actual `/health` identities and source SHAs before starting, between steps and before resuming. Without an explicit map, it pins the first observed valid source set. Reports bind the runner SHA, target source set, configuration fingerprint, plan and run ID. Completed steps are not repeated after a runner restart. An incomplete/failed attempt or a changed source/configuration requires a new run ID; previous evidence is preserved.

The service has no POST endpoint, job execution endpoint, shell endpoint or client-supplied target URL. `/health` exposes only sanitized progress. Use the read token for:

```
GET /reports
GET /reports/<runId>-plan.json
GET /reports/<runId>-load500.json
GET /reports/<runId>-load1000.json
GET /reports/<runId>-soak60m.json
GET /reports/<runId>-wallet-conformance.json
GET /reports/<runId>-network-restart.json
Authorization: Bearer <RUNNER_READ_TOKEN>
```

For wallet/network plans, `/health.waiting_restart` names the exact isolated service and deployment ID to restart. The platform operator performs that Railway restart. There is no acknowledgement API that could manufacture success. The runner must observe a new process boot ID, the same database identity and the same source SHA, then verify retained receipts or native sessions. It records total operator-wait time separately from the observed unavailable-to-ready interval when one is visible. A5-minute bound prevents indefinite waiting. Independent approval, real external operator certification and production activation remain outside this runner.
