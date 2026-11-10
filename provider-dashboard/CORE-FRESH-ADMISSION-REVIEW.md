# Core fresh wallet admission candidate — review only

## Decision and scope

The candidate is suitable for independent CI and further review. Keep it out of
the active telemetry rollout and do not deploy it as a latency fix on the strength
of these tests. The implementation removes one durable journal admission from a
successful **new** debit, credit, or reversal while retaining the existing
durability and recovery boundaries. No measured deployment latency improvement
is claimed.

Review base: `3fe2e048cb1d177b54d361a5e24f8205492bd89a`.
Branch: `review/core-fresh-admission-20261110`.
Date: 2026-11-10. Runtime used for local validation: Node.js 24.22.1.

The source change is confined to [`Core.external`](lib/core.mjs). The reference
wallet, schema, WAL/synchronous settings, round admission controls, authentication,
per-player serialization, receipt validation, and ledger finalization are
unchanged. This is independent of the previously rejected reference-wallet read
routing optimization.

## What changes

| Boundary | Existing fresh path | Candidate fresh path |
| --- | --- | --- |
| Signed request nonce | Its own durable auth admission | Unchanged |
| Round, settlement, or reversal intent | Durable before wallet work | Unchanged |
| Immutable wallet operation + first dispatch marker | Separate durable admissions | One durable admission, same savepoint and commit |
| Debit, credit, or reversal callback | After first attempt marker commits | After combined intent and first attempt marker commits |
| Validated applied receipt | Durable before Core ledger finalization | Unchanged |
| Ledger and round finalization | Durable before successful response | Unchanged |

The candidate still issues the wallet-operation INSERT and the attempt UPDATE.
It groups them in one call to the existing [`DurableWrites`](lib/durable-writes.mjs)
queue. `INSERT OR IGNORE`'s `changes` result identifies a fresh row **inside** the
synchronous transaction; an outside read is not used to decide that an operation
is new. Every pre-existing row continues through the existing recovery policy.

The queue only resolves a caller after the actual COMMIT succeeds. No network
request or promise is introduced inside the transaction. The journal remains
FULL WAL, including its existing independent-operation savepoints and bounded
queue and batch policy.

For an otherwise successful fresh reserve, settle, or reversal, the measured
journal admission count changes from five to four excluding authentication, or
six to five including the separate auth admission. These are logical admissions,
not a promise to eliminate one physical filesystem commit: unrelated admissions
can share a batch. The tests assert admission counts together with independent
database visibility and recovery behavior.

## Credential and validation ordering

A naive `INSERT ... attempts=1` would incorrectly mark an attempt when opening a
corrupt wallet credential fails. This candidate first inserts the immutable
pending intent, then synchronously opens the credential. If opening fails, it
commits that intent with `attempts=0` and propagates the same credential error
after the commit. This preserves the existing failed-credential state and lets a
later retry, after credential repair, dispatch its first attempt without an
unnecessary status request. The credential test covers failure, restart,
repeated failure, repair, and recovery.

Successful credential opening permits the first marker UPDATE in the same
savepoint. A failed marker statement rolls back the fresh row as well; a failed
combined COMMIT acknowledges neither row nor marker and sends no callback. The
earlier durable round intent remains available to recovery.

Existing `ok` and `rejected` records still short-circuit before opening a
credential. Payload-hash conflicts still win before either cached result. Amount,
round, session, operator, authentication, and nonce validation remain at their
existing boundaries.

The marker represents a prepared or potentially dispatched attempt, **not proof
that HTTP reached a wallet**. As before, transport URL/protocol checks, DNS/TLS
validation, admission failure, and transport failure can occur after the durable
marker. Conservatively recording that uncertainty is required for a process crash
between commit and callback. This change does not move transport preflight,
relax SSRF controls, or claim that an `attempts` value is a network-delivery count.

## Recovery and replay policy

| Existing state | Behavior retained |
| --- | --- |
| `pending` or `unknown`, zero attempts | Durably record first attempt, then dispatch |
| `pending` or `unknown`, one or more attempts | Query wallet status first |
| Wallet reports `applied` | Validate receipt and finalize once; no money callback |
| Wallet reports `rejected` | Persist rejection; no money callback |
| Wallet reports `pending` | Keep outcome unknown; no money callback |
| Wallet reports `not_found` | Durably increment attempts, then redispatch immutable intent |
| Local `ok` | Replay stored validated result without callback or credential access |
| Local `rejected` | Reject without callback or credential access |
| Any payload-hash mismatch | Reject conflict without mutation or callback |

For a crash after the combined commit but before callback, recovery sees
`pending/attempts=1`, checks status, and dispatches only after `not_found`. For a
crash after the wallet applies the transaction but before the Core receives the
response, recovery consumes the wallet's applied receipt and writes one ledger
effect. Both cases are exercised separately for debit, credit, and reversal with
real child-process `SIGKILL`, a real SQLite Core database, and an independent
durable SQLite wallet fixture.

Per-player locks still wrap reserve, settle, reversal, and their recovery entry
points. Duplicate concurrent requests continue to converge on one operation.
An already accepted seamless round can still settle after session revocation,
operator disablement, and maintenance. These tests do not establish a new
multi-process or multiple-writer ownership model; the candidate preserves the
current model.

## Validation

Final local validation passed **94 tests, zero failures** across two commands:

From `provider-dashboard`:

```sh
node --test --test-concurrency=1 test/core-fresh-admission.test.mjs test/core-phases.test.mjs test/core-phases-http.test.mjs test/core.test.mjs test/durable-writes.test.mjs test/wallet-transport.test.mjs
```

Result: **86 passed** (38 new admission tests and 48 existing boundary tests).

From repository root:

```sh
node --test --test-concurrency=1 qualification/test/core-isolation-review.test.mjs
```

Result: **8 passed**, including actual local HTTP wallet v2 integration,
environment/audience binding, and duplicate settlement. `npm run check` also
passed. The existing TLS-wallet suite contains a synthetic local 500-callback
fixture; this is not a 500-session preproduction qualification result.

The new [`core-fresh-admission.test.mjs`](test/core-fresh-admission.test.mjs) covers:

- Independent reader visibility of exact intent and first marker before callback.
- Six real process crashes across both boundaries for all three wallet actions.
- Failed combined COMMIT, failed first-marker statement, failed retry-marker
  COMMIT, and failed applied-receipt COMMIT.
- Corrupt-credential ordering and repair after restart.
- Existing pending/unknown rows with zero and nonzero attempts, cached applied
  and rejected results, and payload conflict precedence in every stored state.
- Invalid transaction ID, amount, currency, scale, balance, and outcome receipts.
- Response loss, restart recovery, duplicate replay, concurrent same-player
  requests, insufficient balance, durable nonce replay, and settlement after
  revocation.

The new suite is included in `npm test` and the qualification safeguard workflow.
No platform deployment, hosted load test, resource change, or external credential
change was performed for this review.

## Remaining gates and limits

The prototype is reviewable and its local financial invariants pass. Independent
CI must pass at the published review commit before it can be considered for a
separate rollout. Keeping the branch separate also avoids attributing any
telemetry-only deployment result to this candidate.

If subsequently selected for an isolated preproduction trial, compare the same
workload and runtime configuration against the accepted baseline, record logical
admissions and physical batches separately, and preserve the project gates before
500/1,000 sessions or soak escalation. A reduced admission count alone does not
prove lower round p95 or justify an infrastructure upgrade.

The credential decryption for a fresh operation now runs in the synchronous
journal body. It is local AES-GCM work that was already required on that request,
but its placement may affect shared batch-body time under concurrency. That effect
requires measurement; the local correctness suite is not a latency benchmark.

Process termination tests prove restart behavior at deterministic software
boundaries. They do not simulate hardware power loss, storage-controller failure,
or every filesystem failure. The existing FULL-WAL durability contract is relied
on and is not weakened. There is no schema migration; the prior Core code can
read candidate-produced rows and use its existing status-first recovery path.
