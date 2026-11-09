# Soft Tech / Provider Control Dashboard (Sandbox Demo)

Independent dashboard service that complements, without changing, the locked Soft Tech marketing website.

## Scope
Six pages: Overview, Games, Operators, Sessions & Ledger, Reconciliation, API Developer. Supports server-enforced administrator/auditor separation, in-memory operator toggles, simulated reconciliation, protected HTML and OpenAPI downloads, responsive menus, original logo and Minecraft typeface.

IMPORTANT: This is a reconstructed demonstration based on the previous six-page dot checkpoint, NOT a copy of unavailable dot sandbox files. No live Playground integration, financial balances or real player sessions. All balances, operators and rounds are fictional and reset at process restart.

## Requirements
- Node.js 22 or later
- PANEL_ADMIN_PASSWORD (min 16 chars)
- PANEL_AUDITOR_PASSWORD (min 16 chars)
- PANEL_SESSION_SECRET (min 32 chars)
- PORT (optional, default 8080)

Run npm start and visit http://localhost:8080. Run npm run check and npm test for QA.

## Deployment
Existing Railway project Soft-Tech, isolated service soft-tech-provider-panel, source branch feat/provider-panel-demo-20261109, rootDirectory /provider-dashboard, command npm start, healthcheck /health. Set the three secrets in Railway service variables. Enable app sleeping when inactive and modest CPU/RAM caps. Confirm workspace plan, credits, real usage and spending limits before starting a new billable instance.

## API documentation
Authenticated API Developer section provides downloadable:
- soft-tech-provider-api-developer-demo.html, self-contained draft
- soft-tech-provider-openapi-demo.json, machine-readable implemented demo endpoints; planned game/wallet contract marked NOT_IMPLEMENTED

## Security and production gates
- Signed HttpOnly SameSite=Strict session cookies, admin vs auditor authorization at the server, login rate limiting, CSP and same-origin write checks.
- No real API keys, operator secrets or financial transactions are included.
- Before live use: durable database, robust user management, scopes, secret rotation, audit persistence and signed Playground backend adapter.
- No real ledger/wallet/game flow should be enabled before end-to-end test, security review and applicable licensing work.
