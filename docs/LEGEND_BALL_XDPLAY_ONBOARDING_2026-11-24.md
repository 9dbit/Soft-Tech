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

## Verification addendum, 24 Nov 2026
- The portal branch was rebased onto current XDPLAY release `740a08320611c6483b31024fd9e46bcbffb721b6`, retaining the active statuses of Skygate, Mahjong Wild, UNO and Gachamon. Pull request `https://github.com/9dbit/Soft-Tech/pull/15` changes only LEGEND BALL canonical runtime origin in `config/game-runtimes.json`; all other game registry entries are identical to the target base.
- Existing domain-standard regression test was updated narrowly to expect `legendballx.xd-play.com` rather than the retired host.
- LegendBallX portal gate CI `45375450068`: SUCCESS. Existing XDPLAY game domain standard `45375450025`, Mahjong launch acceptance `45375450177`, Skygate secure launch `45375450143`: SUCCESS on candidate `49129e3d06c9ecbe9a7f47be1ea300623257f667`.
- Game-production Railway deployment `452810f8-eee5-4717-97fb-93f4793d2aac`: SUCCESS, isolated production project; fallback hostname explicit allowlist and Studio password configured. Live validation still subject to a separate CI run.
- **DNS remains unverified**, ownership still pending, TLS certificate validating. Zone file is a record proposal only; no Cloudflare DNS mutation has been completed. Launch remains `staging_only` and iframe URL is absent.
- Shared production XDPLAY service has an unrelated 24-change staged Railway patch. It was not accepted. No portal production deployment or public launcher activation was made during this checkpoint.
- Exact DNS needed: `legendballx` CNAME `rtchmvzp.up.railway.app` and `_railway-verify.legendballx` TXT `railway-verify=934da057b69de43039ac52b4c60636f2f4890a8b9f91e8de36ac76ccb423bf64`.
- Rollback remains registry-only: keep LegendBallX `staging_only` and drop new DNS records if needed. Production game volume remains independent.

## Final production-demo evidence (before DNS)
- Actual production Railway-origin live browser acceptance: **SUCCESS**, GitHub Actions `https://github.com/9dbit/Legend-Ball-X1000/actions/runs/45375703868`, job `138381308804`. Validated root redirect, Studio Basic/CSRF refusal for unauthenticated calls, game-only XDPLAY `frame-ancestors`, all sampled art/assets, WebKit/Chromium mobile safe areas, menu controls and splash/PWA interactions.
- Production game deployment `452810f8-eee5-4717-97fb-93f4793d2aac` SUCCESS, production release storage `/data`, explicit Railway fallback host. This proves Railway service is healthy, **not** that `legendballx.xd-play.com` DNS and TLS are ready.
- Portal PR `https://github.com/9dbit/Soft-Tech/pull/15` is deliberately draft and closed-to-launch. Registry diff confirmed only the LEGEND BALL canonical hostname changed; no other game's entry changed relative to current XDPLAY release.
- Blocker remains: DNS CNAME and TXT must be written at Cloudflare, Railway ownership verified and certificate valid. The shared portal Railway project's unrelated 24-change staged patch is not applied. Once the domain is ready, only then activate `enabled` and run custom-domain iframe acceptance, keeping real-money features disabled.

## Canonical domain qualification, 24 November 2026

Cloudflare now serves the production CNAME and Railway TXT records listed above. Railway confirmed ownership, CNAME propagation and a valid certificate. The custom HTTPS game opened from the splash screen and desktop controls were visible. On the canonical hostname the live HTTP gate in [game acceptance](https://github.com/9dbit/Legend-Ball-X1000/actions/runs/45379886486) passed after certificate issuance. Attempt 1 captured the temporary Railway wildcard certificate during issuance. Attempt 2 uses strict TLS verification.

This candidate admits the Legend Ball virtual-credit demo at `https://legendballx.xd-play.com/play/`. Before publishing, require the browser stage of that run and the portal candidate checks to pass. The live XDPLAY service is pinned. Deploy only `soft-tech-web` to the tested release. The shared environment has pending changes to three other engine services and they must remain staged. To close this launcher, revert just the Legend Ball admission with its registry regression expectations. Preserve other games and the separate production volume.
