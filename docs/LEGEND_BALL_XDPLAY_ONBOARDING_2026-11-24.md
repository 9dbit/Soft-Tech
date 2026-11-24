# LEGEND BALL X1000 → XDPLAY Launcher Checkpoint

Date: **2026-11-24**, WIB

## Locked product identity
- Game: `legend-ball-x1000`
- Runtime: `https://legendballx.xd-play.com` (supersedes retired plan `legend-ball.xd-play.com`)
- Launcher: `https://xd-play.com/games/legend-ball-x1000/play`
- Game repository `9dbit/Legend-Ball-X1000` at `security/legendballx-demo-production-20261124`, parent V13 `f50948e47a9ffd46ef42bb6386dfbf827696554e`.
- XDPLAY source baseline: `rebrand/xdplay-public-20261112` at `95494199f8d4885155d2117f5586c9e3d2692fd4`. This branch changes only the LEGEND BALL entry, standalone DNS record plan and scoped tests. Other game statuses are immutable for this PR.

## Railway isolation
- Staging project `7acb5534-6785-4046-8dfb-e556b4aace76` remains unchanged; staging domain `staging-legend-ball.xd-play.com` already verified with valid TLS.
- New production-only project `467970bf-1be7-4e9b-88aa-a39ae69cef55`, environment `4fa24fdf-721e-4206-9918-6e0d2fc5d858`, service `71ba10d1-bd26-48dc-9f61-3a917aac200f`, volume `d7fedfcf-1494-4042-9505-b68a08440e70` at `/data`.
- Railway service fallback `legendballx-demo-web-production.up.railway.app`.
- Runtime must have `LEGEND_PUBLIC_DEMO=true`, `LEGEND_PUBLIC_HOST=legendballx.xd-play.com`, `SKYGATE_STUDIO_REQUIRE_AUTH=true`, `SKYGATE_STUDIO_PUBLIC_TESTING=false`, distinct Studio password, `GAMEOPS_BRIDGE_ENABLED=0`.
- Virtual credits are local/synthetic. No real-money wallet, transactions, shared session store or staging database.

## Public game vs Studio
- Previous staging HTTP 503 on root came from authentication on `/` (redirect target Studio); `/play/` already served gameplay.
- Production-only root `/` redirects to `/play/`; Studio remains behind Basic auth and per-request CSRF/same-origin controls. Studio cannot be framed.
- Only game HTML may be framed by `https://xd-play.com`, via CSP `frame-ancestors`. No wildcard CORS, SameSite=None cookies, or real-money API.
- Unrecognized production host rejected; protected routes never lose authorization.

## Domain registration
Railway returned the following exact records; these are **not proof that DNS was written**:

| Type | Hostname | Required value |
|---|---|---|
| CNAME | `legendballx.xd-play.com` | `rtchmvzp.up.railway.app` |
| TXT | `_railway-verify.legendballx.xd-play.com` | `railway-verify=934da057b69de43039ac52b4c60636f2f4890a8b9f91e8de36ac76ccb423bf64` |

Gate requires ownership VERIFIED, certificate VALID and live domain assets before launch.

## Launcher gate
- Until every condition passes, LEGEND BALL registry remains `publicLaunch=staging_only`, `domainReady=false`, `deploymentOrigin=null`, `entryPath=null`.
- When ready, update only LEGEND BALL to `publicLaunch=enabled`, `domainReady=true`, `deploymentOrigin=https://legendballx-demo-web-production.up.railway.app`, `entryPath=/play/`. `src/components/game-viewer.tsx` automatically embeds the same-site runtime.
- Scope: demo launch only, no payment or wallet integration.
- The XDPLAY production Railway service has an unrelated preexisting **24-change staged patch**. Never accept or apply that patch as part of this onboarding. Deploy portal change only from a reviewed commit after this config conflict is resolved without touching other games.

## Evidence / blockers
- Game CI: `https://github.com/9dbit/Legend-Ball-X1000/actions/runs/45374260402` (current pending at first checkpoint write).
- Portal CI: pending.
- Production Railway deployment: first source deployment pending at first checkpoint write.
- Domain ownership and SSL: not yet verified at registration; re-check provider.
- Browser QA including iPhone PWA resume, audio, fullscreen, mobile/desktop layout: pending external URL qualification.
- DNS changes: zone file prepared, not written to provider by this commit.
- Rollback game: detach the production custom domain immediately, or restore the previous approved runtime revision `f50948e47a9ffd46ef42bb6386dfbf827696554e` without enabling demo mode. Preserve /data volume.
- Rollback portal: return only LEGEND BALL registry status to `staging_only`, or restore the baseline deployed portal commit. Never revert other game's newer changes or apply the old 24-change Railway patch.
