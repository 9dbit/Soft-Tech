# Soft Tech Independent Provider Core: acceptance verified

Date: 2026-11-09 (Asia/Jakarta)
Dashboard: https://soft-tech-provider-panel.up.railway.app/

## Release and scope

The live provider core is pinned to `1c7c3b1dcb9907bf6f69ab7024090332b5e1bfd9` on `feat/provider-core-independent-20261109`.
Runtime application is the independent v1 core from `f3e761be5e13c2cb73ed1aaae48d1202d7b19b64`, with a public-routing readiness gate added to acceptance. Commit `f31976f91e14fc2d5d090dd71dce8ebca6ae5b86` only strengthens browser tests to verify each original game image has decoded before screenshot capture. It does not change the deployed runtime.

This is an operational SANDBOX integration of the three native game runtimes. It is not a production real-money certification. Credits are free virtual test credits with no monetary value.

## Failure investigation and repair

The interrupted assistant session did not establish a deployment failure. On resumption, live Railway reads found a newer v1 core and three dedicated native provider services already deployed. These were preserved rather than overwritten with a stale local draft.

Acceptance `provider-v1-20261109-01` failed at 12:25:24 UTC with `Not all provider engines report ready`. The Mahjong runtime became ready later at 12:27:29 UTC.

Acceptance `provider-v1-20261109-resume-02` then encountered a Mahjong wallet callback timeout during core rollout. Core proxy HTTP logs recorded POST `/api/v4/agency-game/redeem`, status 499, Python urllib client, 12,011 ms, connection dial timeouts to the previous deployment instance. This was not a wrong-signature response or an engine-math failure.

The readiness gate now requires BOTH: all three configured engines healthy, and the PUBLIC core health URL exposing the current running acceptance ID. This prevents testing before the public callback route has switched to the new instance. Probes are bounded, read-only, contain no credentials, and have their own six regression tests. Failed historical runs were retained, not erased.

## Live end-to-end evidence

Acceptance ID: `provider-v1-20261109-public-ready-03`.

At 2026-11-09T12:55:06.163388394Z (19:55:06 WIB), Railway runtime logged:

`provider.acceptance.passed provider-v1-20261109-public-ready-03 6`

The checked-in acceptance runner tests two separately credentialed INTERNAL operators, A and B, against all three real deployed engines. It does not use generated fake round records or override RNG.

- UNO LUCK: launch, three native pick phases, completed round, repeated final request returns same round.
- Mahjong Wild: launch, real ticket/state, native spin, repeated request returns same ticket/outcome.
- Skygate 5000: launch, native state/release, spin, repeated request returns same round.
- Each session has exactly one persisted settled provider round, one debit journal entry and one credit journal entry.
- The other operator receives 404 for that round; the owning operator receives 200.
- Each operator's reconciliation result must be matched.
- Six cases passed: two per game. Report and round references are persisted in the provider database and available through authenticated GET `/api/acceptance` and the master panel.

## Automated and visual QA

Workflow: https://github.com/9dbit/Soft-Tech/actions/runs/42621179746 (SUCCESS).

- 19 persistent-core/security/transaction tests pass: HMAC/replay, operator isolation, single-use launch, idempotency, restart recovery, exact integer accounting, maintenance admission, scoped game credentials, immutable journal, unknown external debit/reversal recovery, callback destination validation, receipt verification, OpenAPI, panel auth and CSRF.
- 6 public-route/readiness regression tests pass.
- 18 actual HTTP dashboard route/role/viewport checks pass: administrator 1440px, administrator 390px, auditor 1280px.
- 18 original artwork load checks pass across overview/games and the three viewport/role combinations. Verified image dimensions: Mahjong 864x1536, Skygate 736x1313, UNO 840x1493.
- API documentation download, operator creation/one-time credentials, read-only auditor and no-activity reconciliation checked.
- Browser screenshots are local-core UI QA evidence, not screenshots of the live production database. They correctly show unconfigured engines because test environment variables omit production engine credentials. Live integration is established separately by the six native acceptance cases.
- Chromium viewport emulation is not a physical iPhone Safari test.

## Railway state verified after acceptance

Project `0e6f5bdf-8437-41e1-a709-b42476cd143e`; environment `9d39a708-0653-4d6c-9f88-d1e730833492`.

| Service | ID | Active deployment | Verified status |
| --- | --- | --- | --- |
| Provider Core (legacy service name soft-tech-v5-preview) | c19f2aa0-8508-430f-a21c-0d3ac1be87bc | 8f060f55-4cd7-468c-9d27-0e74bc088cc5 | SUCCESS / online 1 of 1 |
| softtech-engine-uno | f79366ac-acd4-4b3f-8adb-bd54d29c6c55 | 20c920e0-0975-4d5d-8097-eee605e31569 | SUCCESS / online 1 of 1 |
| softtech-engine-mahjong | 8aea4f06-7f65-43ff-a9f6-08d6e08c8009 | d571d64c-2726-42bb-ae06-1e74313cf2ab | SUCCESS / online 1 of 1 |
| softtech-engine-skygate | edd381a3-11db-4d19-a0f8-23dbccb8e3a6 | 4a895a15-befc-48e5-bff4-a83d5b7b2140 | SUCCESS / online 1 of 1 |
| Marketing website | c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1 | 3e0f34a3-7a6c-48b7-90ca-d3930984b187 | SUCCESS / unchanged |

Railway health read reported zero services with issues, zero crashes, zero current warning/critical issues, no pending staged work. Four independent 1GB volumes persist core and engine data. Provider runtimes are separate from the original public game services.

Original public game source pins were re-read and unchanged:
- UNO: c8327f47086d524a43559e297a42bef183d514e4.
- Mahjong: d75ea42af04bbd027fecc64408f7cb52d1d4cfdf.
- Skygate: 701e88fb281c08fced1b89e221cbbe21751e2ebc.
- Marketing website UI: 2dad8bbd89c9e93a556776051961b9a4c51cca97.

## Operator-neutral integration and usage

Launch through master panel Games > Test Play or the versioned Soft Tech Operator API. These launches generate provider-owned sessions and engine-confirmed rounds visible in Sessions & Ledger and Reconciliation. Standalone old public game URLs are intentionally unchanged; their historical and independently generated activity is not automatically imported.

Operators can receive individually scoped keys, allowed games, currency/scale, permitted return origins and sandbox/seamless-sandbox wallet configuration. The operator API is `/v1/*`; internal game compatibility routes retain `/api/v4/agency-game/*` naming only for adapter compatibility. They point to Soft Tech Core, not an external operator platform.

Authenticated documentation:
- `/api/download/developer.html`
- `/api/download/openapi.json`
- `/api/download/client.mjs`

## Explicit remaining limits

No real-money mode, deposits, withdrawals or untested public operator rollout. External operators must conform to the API and pass their own integration/fault tests; live third-party wallet acceptance was not performed by this run.

Visual/audio/math authoring and release promotion remain in separate game Studios, not unified into the master panel in this release. The initial durable core uses SQLite with one replica, not a horizontally scalable PostgreSQL cluster. Offsite backups, disaster-recovery rehearsal, load/capacity tests and physical iPhone Safari QA remain outstanding.

Do not erase test/audit/ledger records, silently repoint original game services, change RNG/math, or overwrite the pinned marketing UI. Never commit credentials, session cookies, launch tokens or encryption keys.
