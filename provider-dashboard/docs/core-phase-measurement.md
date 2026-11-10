# Core phase measurement contract

This diagnostic records bounded, content-free counters at existing Core call boundaries. It does not change journal admission, the 2 ms scheduling delay, batch/pending limits, SQL ordering, durability, replay policy, wallet transport, request deadlines or retries. It introduces no additional business await. Wallet observation returns the original promise object.

## Scope and identity

`/health` exposes `core_phases` beside the existing source commit, process boot ID and platform deployment ID. Schema 1 also has a random `registry_id` and `reset_count: 0`. There is no reset endpoint. Compare only identical schema, registry, source and process identities. A new registry or process starts new counters; do not subtract counters across it.

Fixed request labels are `engine_redeem`, `engine_status`, `engine_reserve`, `engine_settle`, `engine_void`, `engine_other` and `operator`. All `/v1/` requests use the single operator class; dynamic path components are not retained. Unknown agency actions use `engine_other`. Health, panel/staff, static assets and background work are not HTTP request captures. Journal batch aggregates include untraced work and disclose `unattributed_items`.

### Authenticated game attribution

The existing global schema-1 aggregates remain available. The additive `core_phases.game_attribution` object has its own `schema: 1`, `provenance: "authenticated_engine_key"`, and the ordered fixed labels `unattributed`, `uno-luck`, `mahjong-wild`, `skygate-5000`. Every label is always present in `groups`; an empty group is `{completed_operations: 0, operations: {}}`. Each populated operation uses the same completed/error/abort counters, fixed request counters and phase cells as its global counterpart.

The HTTP handler binds a game only after the original `authenticateDurable` call has succeeded, using the returned verified engine key's game. No header, body field, route fragment, player, session or operator identifier chooses a label. Requests that fail body reading or authentication stay `unattributed`; all operator requests stay `unattributed`. A valid engine authentication followed by malformed JSON or a business error belongs to that authenticated game. Unknown/nonstring game values are not coerced or retained and leave the capture unattributed. A repeated identical binding is harmless; conflicting valid bindings keep the first group and set sticky `telemetry_error` so the interval cannot be treated as valid attribution.

Each request starts with the numeric unattributed group index. All its phase sums, including body/authentication observations made before the game was known, merge into exactly one group when the capture retires. The sum of group completed counts, operation counts, error/abort counters, request counters, additive phase totals and histogram buckets must exactly equal the corresponding global aggregate. Global phase maxima equal the maximum across groups; maxima are never summed or differenced to derive interval latency.

Only request aggregates are split. Shared `journal_batches`, untraced journal items and the process-wide event-loop probe remain global. Per-request batch phase measurements still contain shared inclusive batch costs; splitting requests by game does not turn those costs into exclusive per-game disk work. These groups are process-wide observations for the selected interval, which can include other traffic for the same game. They do not identify a particular qualification run or player.

The group field is optional for compatibility with older health snapshots. Consumers must verify fixed metadata, conservation, stable source/boot/registry and the existing quiet-boundary/loss checks before comparing it. Missing or invalid attribution cannot be reported as zero latency or as an attributed request. The qualification consumer reports its comparability separately from the legacy global comparison. Diagnostic availability does not change a load or resource qualification gate.

The request entry timestamp is taken at Node's HTTP request callback. It cannot measure proxy ingress, TCP acceptance or header parsing that occurred before that callback. A `finish` event means Node completed its response write, not that the remote client received or processed the response.

## Lifecycle and bounds

The registry preallocates 1,024 slots, seven global action aggregates, and four groups with the same seven fixed action aggregates. Each action has 32 phase cells and 20 buckets per cell. Each slot has fixed typed arrays and scalar state, including one numeric group index; no per-game capture arrays or dynamic label maps are allocated. A lease consists of two numbers: slot and generation. AsyncLocalStorage holds only that lease. At most 4,096 phase observations are accepted for one capture; excess observations increment explicit dropped-span counters.

No session, operator, player, nonce, signature, SQL, body, URL, request/response object or exception text is stored in the registry, journal observation token or aggregate output. Temporary HTTP event listeners carry only the numeric lease and normal lifecycle state; the registry does not retain those listeners or response objects. Journal observation metadata is bounded by the existing 1,024-item queue and 64-item batch.

Capture exhaustion drops telemetry and increments `dropped_captures`; it does not reject a business request or create a new queue. Counters saturate at `Number.MAX_SAFE_INTEGER` and set `saturated`. Invalid clock observations do not create fake zero durations. Observer exceptions set sticky `telemetry_error` without replacing the original result, exception or number of business invocations.

A capture retires only after both the original async handler and its response lifecycle finish. If the response closes while a wallet operation is running, the original work continues and the lease remains active. A later response event cannot retire an unrelated request. Generation checks reject stale observation tokens; stale context/observation attempts increment `late_observations`. A partial-body disconnect also retires after the original body reader unwinds.

Journal flushes use a shared timer, which can inherit the first enqueuing request's async context. Every item therefore explicitly restores its own captured lease for its synchronous callback. An untraced item clears that context instead of inheriting a peer's lease. The original callback executes once. No new promise, await or network operation is permitted inside the transaction.

## Phase meanings

All durations use the same process monotonic clock and integer microseconds. A phase is present only when it has a valid observation; missing phases are not zero-duration samples.

| Phase | Boundary and interpretation |
|---|---|
| `arrival_to_body_complete` | HTTP callback entry through successful completion of the existing bounded JSON body reader. Aborted/oversized/unsupported-content-type attempts do not receive this completion observation. JSON parsing and business validity are separate. |
| `body_read` | Existing body-reader entry through return or throw, including waiting for chunks. |
| `auth_total` | Immediately before the existing authenticateDurable call through the existing await continuation, including rejection. |
| `auth_queue`, `journal_queue` | Journal enqueue through selection into a batch, before that batch's BEGIN. |
| `auth_batch_begin`, `journal_batch_begin` | Whole shared batch BEGIN attempt. It is shared, inclusive cost copied to each participating request, not an exclusive per-request cost. |
| `auth_entry_to_operation`, `journal_entry_to_operation` | Batch entry through the start of this item's callback after its SAVEPOINT. Includes BEGIN, earlier items and the item's SAVEPOINT. |
| `auth_operation_body`, `journal_operation_body` | This item's synchronous callback and its RELEASE or savepoint rollback/release handling. The underlying business exception is unchanged. |
| `auth_batch_body`, `journal_batch_body` | Whole shared batch item loop, including all SAVEPOINT/callback/RELEASE attempts. Shared and inclusive. |
| `auth_batch_commit`, `journal_batch_commit` | Whole shared COMMIT attempt, successful or failed. A wall-time SQLite call boundary, not isolated fsync or device latency. |
| `auth_commit_to_resolve`, `journal_commit_to_resolve` | End of the shared COMMIT attempt through immediately before this item's promise resolve/reject. Absent when no COMMIT was attempted. |
| `auth_resolve_to_resume` | Immediately before the auth item's promise resolve/reject through the existing HTTP handler await continuation. Measures actual continuation delay, not a newly attached observer's reaction time. |
| `engine_action` | Existing engineAction call and await, including argument JSON parsing and exceptions. |
| `wallet_balance`, `wallet_debit`, `wallet_credit`, `wallet_reversal`, `wallet_status` | Existing transport invocation through settlement of its original promise. Synchronous throws are included. An observer reaction records completion before the caller resumes; no retry, replacement promise or cancellation is introduced. Existing transport-specific DNS/socket/TLS/body timing remains available separately. |
| `transaction_begin`, `transaction_body`, `transaction_commit`, `transaction_rollback` | Existing synchronous Core.transaction boundaries used by operations such as launch/redeem. Distinct from grouped DurableWrites batches. |
| `handler_total` | HTTP callback entry through the original handler's finally, after its existing success/error logic. Can extend beyond response close if financial work continues. |
| `response_write` | Existing writeHead, serialization and end call, through return/throw. |
| `response_to_finish` | Start of response writing through finish/early close; includes response_write. |
| `request_total` | HTTP callback entry through response finish or early close. Does not include pre-handler ingress and is not a client round measurement. |

These phases overlap and can be nested. Never sum phase percentiles, shared batch costs or inclusive parents/children to reconstruct request latency. Do not subtract cumulative maxima. BEGIN, body, COMMIT and wallet differences cannot identify a disk, fsync, event-loop or proxy cause in isolation.

## Histograms and counters

Request histograms are `per_request_phase_sum`: all invocations of one phase inside one completed request are summed into one histogram observation. `operations` is covered requests; `invocations` is individual observations. `total_us` is additive. `max_operation_us` and `max_invocation_us` are cumulative maxima.

Bucket upper bounds, in microseconds, are 250, 500, 1,000, 2,000, 4,000, 8,000, 16,000, 32,000, 64,000, 128,000, 256,000, 512,000, 1,000,000, 2,000,000, 4,000,000, 8,000,000, 16,000,000, 30,000,000, 60,000,000 and null for infinity. Buckets contain separate populations, not cumulative counts. Percentiles derived from them are bucket upper bounds. The overflow bucket has no finite upper bound.

`journal_batches.phases` counts each begin/body/commit/rollback/resolution phase once per batch. Its histograms are not request histograms. `queue_per_item` counts individual journal items. The same shared batch may contribute to several requests' phase sums, so do not compare a sum of per-request batch costs with the single global batch cost as if they were independent work.

Request counters include body/auth failures, journal item attempts/failures, failed batches affecting an item, queued-journal closure, synchronous transaction failures, invalid clocks and dropped spans. `journal_batch_failures` means the item's batch failed to commit; it does not claim that the failure originated in COMMIT. `journal_closed` distinguishes rejection of a queued item before a batch starts. Errors and aborts remain separate request populations. These counters are not financial receipts, modified row counts or flush counts.

Only completed request captures merge into request aggregates. A mid-run snapshot can favor requests that completed sooner. A closed request interval requires zero active captures at both ends, stable identity, monotone integer counters/buckets, and no new loss/invalid-clock/late-observation count or sticky telemetry error/saturation. Global batch analysis additionally needs attention to pending/unsettled journal items at the boundaries. Background, setup and cleanup populations must be disclosed rather than labeled as pure gameplay.

## Event-loop probe

One unref'ed 100 ms timer observes the delay of its callback beyond the nominal interval and records only bounded aggregate integers and the same fixed histogram. It schedules the next probe from the current callback and does not issue catch-up work. The probe is process-wide and has no request attribution. It cannot resolve where an event-loop stall occurred, measure work before the HTTP callback, or distinguish storage, CPU scheduling, synchronous work and observer sampling effects. The timer stops during server shutdown.

## Verification

The generic tests cover real concurrent SQLite batches, callback ALS attribution, untraced items under a traced timer, savepoint isolation, failed COMMIT with no acknowledgement, exact auth continuation timing, response abort while financial work continues, generation reuse, clock/merge/context failures, span/counter bounds, original wallet promise/error identity, a real event-loop stall, and repeated registry reuse after garbage collection.

The actual local HTTP fixture uses the production Core server, signed callbacks and a loopback wallet. It checks wrong signatures, durable replay, malformed and partial bodies, concurrent status calls, complete rounds and duplicate settlements, client disconnect after wallet application, durable continuation, retry convergence and replay rejection after restart. It is synthetic local verification, not remote capacity qualification or external operator certification.

Attribution tests additionally cover interleaved shared-batch captures classified after their early auth observations, fixed/unknown/hostile labels, operator exclusion, conflicting trusted bindings, aborted requests, stale lease reuse, and exact group-to-global conservation. The HTTP fixture uses all three authenticated game keys and verifies that spoofed body/header game names cannot override them. Repeated 20,000-capture reuse checks fixed memory/cardinality and leaves response space below the unchanged 262,144-byte diagnostic health limit; the populated real HTTP health response is checked against that limit as well. These checks cover the tested population sizes, not an unlimited lifetime promise that arbitrary counter digit growth cannot enlarge JSON.
