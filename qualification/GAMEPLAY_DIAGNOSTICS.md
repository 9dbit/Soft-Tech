# Gameplay boundary diagnostics

`native-load.mjs` retains `gameplay_diagnostics` alongside the existing report. It performs one bounded public `/health` read per fixed service after setup and `onReady`, before the gameplay clock starts. A second read follows completed gameplay and any chaos hook, after the existing elapsed time is recorded and before reconciliation or cleanup. These reads do not use operator credentials, native session cookies, financial request transport or the request-latency metrics. There is no polling, retry or changed gate.

Each boundary records request start/end timestamps separately for Core, reference wallet, UNO, Mahjong and Skygate. The services are read concurrently, so this is a set of process observations, not a single atomic system snapshot. Each read has a five-second timeout and a 256 KiB body limit, rejects redirects and stores only a fixed whitelist. Unknown fields, labels, SQL, URLs, exception text, cookies, borrowers, request objects, player/session/round data and credentials are not copied. Failed reads retain a fixed error code. The existing private report remains protected by the runner's report token and mode-0600 persistence.

## What is retained

- Full source SHA, process boot identity and selected deployment identity fields.
- Core's fixed request-phase counters, twenty-bin histograms, journal-batch counters and event-loop observations.
- Native fixed operation-phase counters and histograms where exposed.
- Numeric process, SQLite, durable-journal, AnyIO limiter and callback/HTTPS-pool diagnostics. Skygate's fixed transport schema is preserved separately from the Python adapters' callback schema.

Only known schema-1 operation/phase/counter labels are accepted for phase comparison. Histograms must have the exact fixed bucket boundaries and consistent integer counts. Missing or malformed observations remain unavailable; they do not become zero-duration samples.

## Comparability

Interval deltas require matching valid source, deployment and process boot identities, chronological boundaries, matching phase schema and registry UUID, and `reset_count: 0`. Both boundaries must have zero active captures. Core also needs no active batch or unsettled journal item. A changed registry/process, incomplete schema, decreased counter, new telemetry loss or invalid-clock count, sticky telemetry error or saturation prevents delta output.

Native versions that do not expose a registry UUID/reset count still have their sanitized snapshots retained, with `REGISTRY_ID_NOT_EXPOSED` / `RESET_IDENTITY_UNVERIFIED`; no native phase delta is claimed. Skygate currently exposes transport and journal diagnostics without native phase histograms. The wallet has numeric snapshots without a phase registry. These are explicitly unavailable for phase comparison.

Deltas contain additive counts, summed microseconds and per-bucket populations. Lifetime maxima are retained only in the original snapshots, never subtracted or relabelled as interval maxima. Histograms represent per-request/per-operation sums of a particular phase; phases overlap. Do not sum phase percentiles, inclusive parent/child times or shared batch costs. Process-wide activity can include unrelated traffic and recovery work between boundaries, even though the load runner's own setup, reconciliation and cleanup are excluded. Recovery/operator operation classes and unattributed journal counts remain visible for that reason.

Diagnostics are not platform resource evidence and have no authority to change `status`, thresholds, workload, concurrency, replay checks, reconciliation or any qualification gate. Additional diagnostic HTTP work happens outside the timed workload; runner reconciliation runtime can include the post-gameplay diagnostic collection, while its counted client requests remain unchanged.

## Completion log

After persisting each new load/soak result, the runner emits one `qualification.step_summary` JSON line. It includes a bounded run ID, start/finish timestamps, runner and target source SHAs, fixed step/status/classification, session and round counts, global and per-game latency quantiles, request error rate, exact gate booleans, reconciliation/duplicate status, cleanup counts and diagnostic comparability booleans. A failed p95 or incomplete resource gate remains failed or unknown. Raw sessions, actors, players, rounds, failure text, URLs and secrets are omitted. Resumed completed reports do not rerun their workload or duplicate the completion log.

The log makes aggregate outcomes inspectable through authenticated platform logs. The full private report and authoritative platform resource attachment remain necessary evidence; a summary log does not certify production readiness.
