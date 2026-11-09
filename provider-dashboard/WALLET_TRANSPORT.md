# Core wallet callback transport

The wallet client uses a process-local HTTPS keepalive pool and one shared TLS
context created with Node's default trust configuration. This removes repeated
trust-context construction and limits simultaneous cold TLS handshakes. TLS
certificate and hostname verification remain enabled. Changes to process CA
configuration require a process restart.

## Fixed resource and time limits

| Resource | Production HTTPS limit |
| --- | ---: |
| Sockets per origin and validated DNS address | 128 |
| Total HTTPS sockets, including idle sockets | 256 |
| Origin/address registry entries | 128 |
| TLS session cache entries | 256 |
| Outstanding calls, including retiring DNS/queued requests | 1,024 |
| Request body | 65,536 bytes |
| Response body | 65,536 bytes |
| Deadline from admission through DNS, socket queue, TLS and complete body | 6,000 ms |
| Idle socket timeout | 1,000 ms |

All limits are code constants. Local test constructors can lower resource limits
and call deadlines; they cannot raise them. The existing explicit loopback HTTP
test mode has a separate 32-socket non-keepalive agent. Public cleartext callback
URLs remain forbidden. Registry and outstanding-call limits cover both modes.

Every call performs a fresh DNS lookup and validates the complete returned address
set before accessing a pool. The pool identity includes the URL origin, selected
address and address family. A changed address cannot borrow the previous address's
connection. The original URL hostname remains the Host and TLS identity, and the
connection's lookup is pinned to the selected validated address. DNS results are
never cached by this client.

Idle registry entries may be evicted; active and queued entries cannot. Old idle
sockets can be reclaimed when a new origin needs the global socket budget. Busy
registry or admission limits reject with `WALLET_BACKPRESSURE` before sending the
callback. Deadline cancellation destroys the request. Its slot is retained until
any outstanding native DNS lookup or destroyed agent-queued request really ends,
so repeatedly timing out cannot grow an unbounded background queue.

## Authentication and uncertain outcomes

Each attempt generates its own signature when it obtains a socket. Operator
identity, v2 environment/audience, nonce, timestamp and exact request body remain
bound to that attempt. No credentials are stored in pool entries or copied from a
previous request. Different origins never share sockets.

The transport does not retry or follow redirects. A disconnect, deadline, oversized
response or interrupted body never creates a success receipt. Existing currency,
scale, transaction, status, amount and canonical integer-balance checks remain in
`wallet.mjs`. Core's durable wallet operation and explicit status recovery still
decide how an uncertain financial operation is reconciled.

## Content-free health

`GET /health` includes `wallet_transport`: bounded aggregate counters, current
resource counts, configured limits and fixed-size timing histograms. It contains
no callback URL, hostname, address, operator, session, transaction, header, request
body, response body or secret. `pending` includes calls awaiting resource cleanup
after their caller has already received a failure; `retiring_calls` identifies
that subset.

The measured intervals are DNS wait, agent queue to socket assignment, TCP
connection, TLS handshake, ready connection to request sent, sent request to
response headers, response body and complete operation. DNS and all other wall
times include event-loop scheduling delay; DNS timing alone is not a measurement
of network resolver latency. Reused sockets do not add TCP/TLS samples. Histogram
quantiles are fixed-bucket upper bounds, capped by the observed maximum, and are
labeled as such. Counters and histograms last for one process lifetime.

## Reproducible verification

Run `npm test` from `provider-dashboard`, or run only the transport suite:

```sh
node --test --test-concurrency=1 test/wallet-transport.test.mjs
```

The suite generates an ephemeral localhost certificate and uses a separate TLS
server process with synthetic credentials. It checks unknown CA and hostname
failure before HTTP, changed-address socket pinning, fresh DNS checks on reuse,
mixed private/public DNS rejection, per-request credentials and v2 audience,
receipt validation, body bounds, no redirects/retries, DNS/TLS/queue/header/body
deadlines, cache/admission bounds and idle eviction. A real Core database restart
recovers a committed-but-disconnected debit by querying status, then settles once.

A 500-call cold phase and a 500-call warm phase verify that all 1,000 callbacks
still perform DNS validation and that connections stay within the configured
bound. `WALLET_TRANSPORT_FIXTURE_REPORT=/private/path/report.json` optionally saves
its synthetic timing summary. This local transport fixture does not certify
deployment capacity, real player sessions, operator wallet conformance, soak
behavior, or a release gate.
