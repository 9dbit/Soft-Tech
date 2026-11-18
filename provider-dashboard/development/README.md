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

Open `http://localhost:8080` and select a development role. Each browser receives
its own sample workspace stored in server memory. Refreshing the page or using
Switch Role preserves that workspace. Logging out, expiry after two hours or a
server restart discards it. Another browser cannot see its changes. Owner can
also reset only their own development workspace.

The UI supports sample operator creation/status, maintenance toggles and
request/validate/approve/reject/cancel workflows. Approval is a simulation with
distinct personas; it is not MFA, a real signoff or permission to deploy.
Game launch, API credentials, live staff changes, wallet calls and release
activation are intentionally unavailable.

## Railway deployment

Deploy in a dedicated project with an environment named `development`, a fresh
service, no persistent volume and no production variables. Root directory is
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
