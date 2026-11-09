# Native-session transport and runner observations

The runner can keep one verified HTTPS connection per authenticated native
session by setting the nonsecret environment variable
`QUALIFICATION_NATIVE_TRANSPORT=per_user_https`. This validates and overrides the
optional `native_transport` setting in the existing protected configuration.
There is no need to read, resend or edit that credential-bearing JSON. The default
remains `shared_fetch`. Invalid transport values fail closed. The effective mode
is recorded in health, plan state and reports, and is bound into the effective
configuration fingerprint and runner plan hash. Changing the mode requires a new
run ID; it cannot resume an earlier run under different connection semantics.

Each session creates its own `https.Agent` immediately before its actual launch
request. The Agent permits one socket and one idle socket, shares a process-wide
default-trust TLS context, and retains certificate-chain and hostname validation.
The same Agent carries that session's state/actions/replays. Server-initiated idle
expiry may require a new connection during a round; this is normal and is counted.
An established session is not a promise that its TCP connection remains open.
The runner does not send keep-alive HTTP requests or perform gameplay to warm it.

The change preserves setup concurrency 40, the full 500/1000-session barrier,
the existing 45-second native request deadline, zero recovery retries in fixed
capacity plans, native request bodies/cookies, every duplicate-result check,
exactly-once reconciliation, round timing boundaries and the 10-second p95 gate.
No client overhead is subtracted. HTTP errors and transport failures still enter
the existing failure metrics. The HTTPS transport never retries a request itself;
an explicit recovery retry, when a separate chaos workflow requests one, remains
the caller's responsibility. Redirects cannot move credentials to another origin.
The serializable context retains only a transport mode marker; the Agent is a
non-enumerable transient property. A restored JSON/structuredClone checkpoint
lazily opens a new connection with the same session cookie. Agents close after
cleanup, including failed launches/load runs and rollback/chaos/recovery stages.

## What is measured

`runner_diagnostics` reports separate setup, running, reconciliation and cleanup
phases. Measurements are fixed-size histograms with three significant digits;
maximum and mean are also retained. There are no per-request log arrays. At most
4096 active sockets are observed; exceeding that bound increments an explicit
counter rather than allocating indefinitely. URL, host, path, address, headers,
body, cookies, signatures and error messages are never included in this object.

| Measurement | Meaning |
| --- | --- |
| `request_to_created_ms` | Wrapper entry until Undici creates its request; shared-fetch transport only. |
| `request_to_sent_ms` | Wrapper entry until request headers are submitted to its socket; includes local scheduling/pool/connection work. |
| `sent_to_headers_ms` | Submitted request until response headers are observed locally; includes network/proxy/server and local scheduling. |
| `headers_to_body_ms` | Observed response headers until full body and JSON handling finish. |
| `dns_lookup_ms` | Socket connect invocation until Node's DNS lookup callback; includes local resolver scheduling. |
| `socket_to_tcp_ms` | Socket connect invocation until TCP connects; includes DNS when applicable. |
| `tcp_to_tls_ms` | TCP connected until TLS is verified and ready. |
| `fetch_resolution_after_headers_ms` | Undici's header event until the fetch promise resumes; shared-fetch only. |
| `total_ms` | Full client wrapper duration, with no excluded phase. |

Connection counters distinguish sockets created during the phase from requests
using an already observed socket. A reused socket may have been established in
setup. CPU usage, average cores, event-loop utilization, a 10 ms event-loop delay
histogram and RSS accompany each phase. A separate bounded monotonic 10 ms timer-lag histogram crosses the phase boundary
without resetting its scheduled callback time. It catches the initial synchronous
surge that Node's histogram can miss immediately after a reset.
The sum of independently sampled p95 values is not a request-level decomposition.
The observer does not change success, latency or resource-gate decisions.

## Reproducible synthetic TLS fixture

Run `node --test qualification/test/runner-transport.test.mjs` on Node 24 with
OpenSSL available. The test creates a disposable local trusted certificate, starts
three HTTPS origins in another process, then runs the existing `nativeCall` and
`playRound` implementations in fresh client processes for each transport. Neither
fixture results nor fixture outcomes are production qualification evidence.

Both clients execute 2334 native HTTP requests: 500 launches, 500 states and 1334
actions, including all 500 duplicate checks. Each creates 500 independent cookies,
uses setup concurrency 40 and starts all 500 users at one barrier. The fixture
asserts no gameplay before that barrier, 500 completed synthetic rounds and no
inserted/removed requests. With the fixture's 30-second server idle timeout, the
per-session transport retains all 500 launch connections. The shared pool opens
hundreds of connections during the running phase. Timing values are reported but
not asserted as a fragile performance ratio; the connection and workload
invariants are asserted.

One local run observed shared-fetch running-phase 710 new sockets and round p95
2011.46ms, versus 0 new sockets and 523.92 ms with per-session connections. The
shared-fetch request-to-sent p95 was 840.70 ms versus 123.33 ms. These measurements
demonstrate client transport overhead locally; actual platform qualification must
be rerun with its real endpoints and unchanged thresholds.

Additional real TLS checks cover an untrusted certificate, wrong hostname,
redirect rejection, multi-cookie preservation, invalid JSON, header/body timeout,
disconnect without implicit retry, explicit retry after a synthetic committed
disconnect, server idle-close followed by a normal reconnect, and origin binding.
An event-loop fixture verifies that a stall immediately after the phase boundary
appears in the running-phase histogram.

Primary API references:

- https://nodejs.org/docs/latest-v24.x/api/https.html
- https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html
- https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html
- https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md

Undici's connector events cannot reliably be attributed to individual requests.
The observer therefore times actual sockets and pairs request events by object
identity, rather than matching connector events by hostname or assumed order.

## Large reconciliation proof

The temporary proof database materializes `expected_wallet_id` for every Core
ledger entry and gives it a non-unique index. The wallet-orphan query uses that
plain key. Its earlier concatenation join produced a scan of the entire provider
table for every wallet receipt, including when all receipts matched. The index
changes lookup cost without dropping any rows, changing pagination limits,
changing amounts, or weakening orphan/mismatch/cardinality checks. The index is
deliberately non-unique so duplicate debit or credit rows still reach the existing
cardinality checks. A file-backed 200,000-receipt fixture asserts the actual SQLite
query plan uses the index, verifies matched data, then detects missing receipts,
orphan applied receipts, duplicate ledger entries, rejected status and altered
amount/currency/scale.

The heartbeat and final report also expose completed-round counts by game. The
read-only health progress includes the same counters so storage projection can
use measured game-specific throughput instead of assuming equal throughput from
equal session counts. These counters do not change workload or gate decisions.

The heartbeat, read-only health progress and final report include `round_latency_by_game` for the three fixed
game IDs. Each measures the same whole-round boundary as the global latency,
including the existing duplicate-result check. Each game retains at most 100,000
uniform reservoir samples and labels whether its quantiles are exact or sampled.
These diagnostic groups do not replace or alter the global p95 acceptance gate;
unsupported caller-provided labels cannot create additional groups.
