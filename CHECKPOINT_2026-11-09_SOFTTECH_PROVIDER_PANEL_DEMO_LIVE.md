# Soft Tech Provider Dashboard | Live Sandbox Checkpoint

Date: 2026-11-09 (Asia/Jakarta)

## Result
- Dashboard: https://soft-tech-provider-panel.up.railway.app/
- Authenticated API HTML guide: https://soft-tech-provider-panel.up.railway.app/api/download/developer.html
- Authenticated OpenAPI JSON: https://soft-tech-provider-panel.up.railway.app/api/download/openapi.json
- Source repo: https://github.com/9dbit/Soft-Tech/tree/feat/provider-panel-demo-20261109/provider-dashboard
- Runtime app source pinned to commit 257f951c9153d30c6d117182c00090ff6abf0b59.
- Later branch commits 6977b192 and 7f971843 only add and improve browser tests, leaving runtime app source identical.

## Deployment architecture and cost guard
- Reused pre-existing Railway preview service soft-tech-v5-preview, id c19f2aa0-8508-430f-a21c-0d3ac1be87bc.
- Railway project Soft-Tech, id 0e6f5bdf-8437-41e1-a709-b42476cd143e; production environment 9d39a708-0653-4d6c-9f88-d1e730833492.
- Root directory /provider-dashboard, Node.js 22 start command npm start, healthcheck GET /health.
- Limits 0.5 vCPU / 500MB RAM, sleep application enabled. No additional paid Railway service was created, because the workspace actual billing/usage could not be verified. Official published pricing was checked, but the user's account spend balance was not available.
- Renamed the preview domain from soft-tech-v5-preview-production.up.railway.app to soft-tech-provider-panel.up.railway.app; original preview is no longer served at its former URL.
- Prior preview source is preserved in GitHub: repo 9dbit/Soft-Tech, branch fix/v61-complete-minecraft-coverage-20261102, pinned commit 2dad8bbd89c9e93a556776051961b9a4c51cca97. Its V5 UI can be restored by reconnecting that source and resetting rootDirectory.
- Railway dashboard deployment fece5cc6-82fa-4240-ba91-1df500b89710 status SUCCESS, service online 1/1, 0 crashes/warnings; startup log shows listening on port 8080.
- Production marketing website remains deployed from pinned commit 2dad8bbd89c9e93a556776051961b9a4c51cca97 and is unaffected.

## Scope / limitations
- Reconstructed six-page panel using available dot checkpoints because original unpublished dot sandbox files were not accessible. Do not claim it is a byte-for-byte replica.
- Modules: Overview; Games; Operators; Sessions & Ledger; Reconciliation; API Developer.
- Admin and auditor login use different server environment passwords, HMAC-signed HttpOnly SameSite=Strict sessions, in-memory rate limiting, authorization on POST routes and CSP.
- Minecraft local WOFF2 and original Soft Tech logo from immutable Git blob sources; monospace copy and responsive sidebar.
- Synthetic/demo dataset only: Skygate 5000, Mahjong Wild and UNO Luck; sample operators, round/session counts and VCOIN credits. No real Playground ledger, payments, game APIs, real operator accounts or financial effects connected.
- Buttons for demo operator enable/disable and reconciliation update in-memory samples and audit history, reset on process restart.
- HTML Developer Guide and OpenAPI v3.1 document are protected downloads. Proposed wallet/session routes are clearly marked NOT_IMPLEMENTED.
- Credentials are stored only in Railway environment variables and were shared in the requesting chat. Do not commit passwords to repository.

## Quality gates
- GitHub Actions initial smoke run 42574900849 SUCCESS, including role authorization, API download, in-memory reconciliation and login.
- GitHub Actions final browser workflow run https://github.com/9dbit/Soft-Tech/actions/runs/42575754256 SUCCESS.
- Verified desktop 1440 and mobile 390 via Chromium: six navigation modules, mobile sidebar slides into viewport, no horizontal overflow, actual Minecraft font loaded, logo ready, admin/auditor permissions, login/logout, HTML/OpenAPI download, sample reconciliation, and no JS page errors.
- Screenshot archive artifact soft-tech-provider-panel-browser-qa in run 42575754256.
- Browser testing was Chromium mobile viewport emulation, not iOS Safari device testing.

## Next milestones
1. Review the dot-created sandbox source if made accessible; reconcile exact original field/module differences.
2. Confirm Railway Workspace Billing/Usage before allocating a new independent billable service; then move from the reused preview service if desired.
3. Replace mock data with a read-only, authenticated Playground adapter; explicitly verify ledger/schema and operator mapping before any write integration.
4. Enforce durable authentication, proper RBAC, persistent audit, integration idempotency, signed callbacks, rate limits and release QA before real users/operators.
5. Rotate temporary admin/auditor passwords after first access.
