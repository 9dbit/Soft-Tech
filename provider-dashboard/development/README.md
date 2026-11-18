# XDPLAY development role access

This is an isolated, sample-data dashboard for previewing Owner, Operator,
Approver and Auditor workflows without entering passwords. It uses a separate
HTTP entry point and browser cookie. It never imports or starts the production
provider Core, staff authentication, wallets, game adapters, backup jobs or
release-control services.

## Run locally

Use Node.js 24:

```sh
NODE_ENV=development XDPLAY_DEVELOPMENT_ONLY=true CORE_ENVIRONMENT=development PORT=8080 node development/server.mjs
```

Open `http://localhost:8080` and select a development role. Each browser receives its own isolated sample workspace. Without\n`XDPLAY_DEVELOPMENT_DB_PATH`, the workspace stays in server memory. With\nthat variable configured, session data and sample operators are persisted\nto a SQLite database on the dedicated development volume, surviving server\nrestarts. Refreshing or using Switch Role preserves that workspace. Logging\nout or expiry after two hours discards it. Another browser cannot see its changes. Owner can
also reset only their own development workspace.

The UI supports sample operator creation/status, maintenance toggles and
request/validate/approve/reject/cancel workflows. Approval is a simulation with
distinct personas; it is not MFA, a real signoff or permission to deploy.
Game launch, API credentials, live staff changes, wallet calls and release
activation are intentionally unavailable.

## Railway deployment

Deploy in a dedicated project with an environment named `development`, a fresh\nservice, no production variables, and optionally one dedicated development\nvolume mounted to `/data`. Set `XDPLAY_DEVELOPMENT_DB_PATH` to\n`/data/xdplay-development/sessions.sqlite` when using the volume. Root directory is
`/provider-dashboard`; Dockerfile is `development/Dockerfile`; health check is
`/health`; start command is `node development/server.mjs`.

Configure these service variables:

- `XDPLAY_DEVELOPMENT_ONLY=true`
- `CORE_ENVIRONMENT=development`
- `XDPLAY_DEVELOPMENT_PROJECT_ID`: exact new Railway project ID
- `XDPLAY_DEVELOPMENT_ENVIRONMENT_ID`: exact new Railway development environment ID
- `XDPLAY_DEVELOPMENT_SERVICE_ID`: exact new Railway service ID
- `XDPLAY_DEVELOPMENT_ORIGIN`: exact public HTTPS origin, without trailing slash

The first three allowlist IDs must match Railway's immutable runtime IDs. The
server refuses other environment names and refuses live provider database,
staff/password/session secrets, engine origins/credentials, wallet and backup
configuration. `NODE_ENV=production` only enables secure cookies; it does not
turn this application into the production provider.

The production server and staff policy are unchanged. A development cookie
cannot be exchanged for a production session. All writes require same-origin
requests and CSRF tokens; sign-in is bounded and sessions expire server-side.

## Verification

```sh
node --check development/server.mjs
node --test test/development-http.test.mjs
```

Browser QA should cover all four sign-ins, refresh, role switching, role-specific
demo permissions, independent approval, sign-out, and desktop/mobile overflow.


## Games: per-operator settings (development only)

The Games page now lists the sample operators assigned to each game. Owner and
Operator may open Settings for an assignment and edit:

- enabled/disabled for that operator
- maintenance mode for that operator
- virtual VCOIN minimum and maximum bet limits, integer values 1 through
  100,000,000, with min <= max

Each assignment carries a monotonically increasing revision; stale writes are
rejected. Changes have a server-side audit event, persist with the browser's
development session on the dedicated SQLite volume, and are considered in
sample release request/validation/approval eligibility. New sample operators
receive default sample settings for each assigned game.

These are **not** live game settings. RTP, RNG, mathematical outcomes, signing
keys, real-money currencies, callbacks, engine deployments and production
release activation cannot be changed from this dashboard. The integration
contract for actual operator/engine settings requires separate sandbox
certification and distinct production authentication.


## Finance & Billing: development preview

The dashboard contains a **Finance & Billing** page that is entirely isolated
from the provider core, Playground, wallets, banking, staff login, tax reporting
and operator contract systems. It is NOT an accounts-receivable or production
invoicing service.

For each sample operator, an Owner may maintain a billing contact and integer-IDR
demo tariff assumptions (monthly and per-completed-session rates, optional setup
fee for future work, tax basis points and payment terms). These fields do not
change the game ledger and no charge is automatically incurred.

An Owner can draft a **DEMO-YYYYMM-#####** invoice, with a frozen line-item
snapshot of sample sessions in the selected billing month. Duplicate active
months per operator are rejected. Approver may change a draft to issued, with
an independent development role; Owner can subsequently mark an issued invoice
as PAID (DEMO only). Approver can void drafts or issued samples. These are
simulated status transitions; no money is received, no invoice is emailed and
the preview provides no payment instructions.

The overview includes sample draft, issued, overdue, paid and IDR outstanding
counts. The invoice detail modal is a nonpayable HTML preview. It is NOT a
legal tax invoice, PDF, or regulated accounting record. The configured tax
rate is only a testing assumption, not a representation of applicable taxes.

Like the rest of the development app, records belong to one browser's short-
lived 2-hour session, saved on the dedicated SQLite development volume if
configured. Logout/expiry removes them. Data is not a persistent organization-
wide billing database and will not be shared with production.

A real finance launch still needs a durable multi-user store, real operator
identities and commercial contract pricing, signed immutable accounting
postings, financial reconciliation, formal invoice number and PDF generation,
tax-compliant fields, delivery, receipt verification, audit/backup retention,
and a documented approval/reversal policy.
