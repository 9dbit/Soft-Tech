# XDPLAY game domain standard

Decision date: 24 November 2026, Asia/Jakarta.

## Decision

Every independently deployed game receives a separate runtime subdomain. The
apex domain remains the public catalog and the shared launcher. Folders identify
portal pages; they do not combine game runtimes into the portal origin.

| Game | Portal launcher | Canonical runtime | Staging runtime | Public admission |
| --- | --- | --- | --- | --- |
| Skygate 5000 | `/games/skygate-5000/play` | `skygate.xd-play.com` | Not provisioned | Virtual-credit demo |
| Mahjong Wild / Mahjong Legend project | `/games/mahjong-wild/play` | `mahjongwild.xd-play.com` | `staging-mahjong.xd-play.com` | Virtual-credit demo |
| UNO Luck | `/games/uno-luck/play` | `uno.xd-play.com` | `staging-uno.xd-play.com` | Virtual-credit demo |
| Legend Ball X1000 | `/games/legend-ball-x1000/play` | `legendballx.xd-play.com` | `staging-legend-ball.xd-play.com` | Virtual-credit demo |
| Gachamon | `/games/gachamon/play` | `gachamon.xd-play.com` | `staging-gachamon.xd-play.com` | Staging only; unavailable |

Production names for unreleased games are reservations in configuration, not
authorization to expose staging as production. The four admitted demos use
their verified canonical subdomains. Gachamon remains reserved and unavailable.
The UNO host guard in `src/proxy.ts` only handles traffic accidentally sent to
the portal service; the real UNO subdomain is served by its isolated game service. No deployable UNO Runner runtime was
identified in the reviewed projects; an unknown game ID fails closed.

## Why this architecture

Subdirectories share a browser origin. Separate subdomains isolate DOM access,
local storage, IndexedDB and service-worker control between the portal and each
game. This reduces the reach of a game-side script error or compromised page.
Each service can also deploy, roll back and scale independently. Hostnames alone
do not provide infrastructure isolation; the services must remain separated.

Subdomains under the same registrable domain are still **same-site**. Use
host-only cookies, explicit request-origin/CSRF validation and narrowly scoped
framing rules. Do not depend on SameSite cookies alone against sibling-domain
requests. New authentication cookies should use the `__Host-` prefix where
supported, Secure, HttpOnly, Path=/ and no Domain attribute. This release keeps
existing game cookies and their host-only scope.

A subdomain is not inherently faster. Its first request can add DNS/TLS setup.
The practical benefits are independent caching/deployment and keeping game
traffic away from portal rendering. Runtime assets and game API requests remain
on the same runtime origin, avoiding a new cross-origin API dependency.

References:

- https://web.dev/articles/same-site-same-origin
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors

## Shared release contract

`config/game-runtimes.json` is the single destination registry. Build-time
validation rejects duplicate origins, unapproved origin formats, staging names
used as production, query-bearing destinations and active destinations on
unreleased entries. Callers cannot supply a runtime URL.

`/games/{id}/play` renders one shared responsive launcher. Verified same-site
runtime domains use an iframe; pending domains offer an explicit top-level demo
link. A Railway iframe would be cross-site and could lose Mahjong's SameSite=Lax
session, so the fallback never embeds a cross-site runtime. Each embedded
response permits exactly its game's verified runtime in CSP `frame-src`;
pending and blocked entries permit none. Blocked games also have no external
runtime link. The iframe has no-referrer,
bounded sandbox permissions and fullscreen delegation. The viewer itself cannot
be framed. A separate-window link provides a fallback for browser storage or
embedding restrictions.

Legacy `/play/{id}` GET/HEAD requests redirect to a fixed canonical portal
launcher. Incoming query strings and tokens are discarded. Mutation methods
are rejected; unknown IDs return 404. Public catalog titles, artwork, math and
game presentation are not changed by this architecture.

Mahjong's successful `/play/` document permits only `https://xd-play.com` as its
parent. Its root document, Studio, admin, API and error responses retain their
existing frame restrictions. Its service worker does not cache HTML documents,
so an old cached DENY document cannot replace the new embed response. Game API
calls stay within the iframe's own origin; portal-to-game CORS is not opened.

## Initial DNS activation and staged rollout (historical)

This section records the initial rollout before the later UNO and Legend Ball
activations. The current configured admission is in the table above and in
`config/game-runtimes.json`.

At registration time all `domainReady` flags were false. The two admitted demos
used top-level links to their approved Railway service origins. Six custom hostnames
had been registered with Railway, but registration is not DNS/TLS completion.
At that checkpoint the Cloudflare session required account sign-in before records could be applied.

`dns/xdplay-game-domains.zone` contains the twelve exact CNAME/TXT records from
Railway. `dns/registration-receipt.json` records their original registration
snapshot. Verification TXT values are public DNS ownership records, not API
credentials. Inspect existing records for conflicts before applying this file;
do not replace apex, www or existing unrelated records. Start the runtime CNAMEs
in DNS-only mode while verifying Railway ownership and certificates.

Release sequence:

1. Release the tested Mahjong `/play/` endpoint before the shared portal viewer.
2. Release the shared portal with top-level links to approved runtime origins.
3. Apply the exact registered DNS records after account authentication.
4. Verify ownership, valid TLS, correct Host routing, health, assets, API
   same-origin behavior and expected frame restrictions for each hostname.
5. Set `domainReady: true` only for an admitted runtime after these checks, then
   rebuild and deploy the portal. The launcher switches from top-level mode to
   embedded mode; CSP and iframe destination change together.
6. Keep UNO, Legend Ball and Gachamon public admission blocked until their own
   security and release gates pass. Staging hostname availability does not open
   the public launcher.

Moving to a new origin creates a new browser storage/session scope. Existing
virtual-credit state on a Railway hostname does not automatically migrate.
Never transfer cookies, long-lived secrets or wallet credentials in a URL.

Rollback: set the affected admitted game's `domainReady` to false and deploy
the portal, returning to its known top-level service-origin launch and disabling
framing in CSP.
Restore the prior portal/runtime release if an application regression occurs.
Do not accept unrelated staged Railway environment patches during this rollout.

## Verification

The domain workflow checks the destination registry, public admission,
compatibility redirect behavior, HTTP security headers and desktop/mobile
viewer behavior in both pending-domain and verified-host fixture builds.
Only the isolated, non-deploying CI workspace changes readiness for that second
fixture build. Browser fixtures exercise actual browser origin isolation and
input/fullscreen delegation without gameplay sessions or wallet API requests.
Runtime-level Mahjong tests cover the compiled document, assets, local virtual
game API/session behavior and protected Studio routes. Live DNS/TLS and runtime
readbacks are separate release checks, not implied by fixture tests.

Next.js is pinned to 16.4.6 with a committed dependency lock after 16.4.3 was
reported vulnerable by the production build and npm audit. The local production
build passed and the production dependency audit reported zero findings on
24 November 2026. This is a point-in-time dependency result, not a guarantee of
absence of all application vulnerabilities.

Security release reference: https://nextjs.org/blog/november-2026-security-release


## First verified domain activation — 24 November 2026 (historical)

The user selected `mahjongwild.xd-play.com` as the canonical Mahjong hostname.
Railway reports ownership verified, CNAME propagated and valid certificates for
this host and `skygate.xd-play.com`. Both `/play/` documents and health endpoints
responded with HTTP 200 on their canonical HTTPS hosts. Mahjong's document hash
is unchanged from the approved runtime release. Its session endpoint returned
HTTP 200 with a host-only Secure/HttpOnly/SameSite=Lax cookie; anonymous Studio
remains 401, an unrecognized play route remains 404, and the stylesheet is 200.
At this first activation checkpoint only the two admitted demos had
`domainReady: true`; UNO, Legend Ball and Gachamon admission remained closed. Staging DNS activation does not change admission.

The CI matrix now explicitly prepares both pending and verified fixture states,
so rollback coverage remains active even when the deployed registry is ready.
The earlier `dns/registration-receipt.json` remains an historical snapshot;
`dns/xdplay-game-domains.zone` reflects the selected Mahjong hostname.


## Four-game catalog completion — 24 November 2026

The canonical runtime table and `config/game-runtimes.json` now admit Skygate,
Mahjong Wild, UNO Luck and Legend Ball X1000 as virtual-credit demos. All four
use `domainReady: true` and their separate production runtime services. The
public `/play/` endpoint is distinct from each game's protected Studio root.
Admission does not itself prove current runtime health.

`src/data/games.ts` provides the public catalog, detail pages and game counts.
The Legend Ball entry uses the unchanged shipped 512×512 brand image
`play/icons/legend-brand-v12-maskable-512.png` from game commit
`3aa6c1e0e31bf6fdd5cb66461f6ebca05c9fd69b`, copied to
`public/assets/legend-ball-x1000-cover.png` (246,467 bytes; Git blob
`c5dc4aa2c589a5a97705ff1e2c2f3ade26c9cfa2`). This original compact brand artwork
has a safe-area inset that fits the existing card crop and avoids a larger
publication payload; it has not been resized, converted or recomposited.
Existing artwork, fonts and
layout styles are retained. Counts on desktop/mobile, navigation, cards and
stories are derived from the catalog. The sitemap includes the admitted detail
pages.

`config/catalog-policy.mjs` is checked when the runtime library is loaded during
the production build. It rejects enabled runtimes missing a catalog/detail
entry, duplicate IDs, unregistered catalog entries, non-canonical launcher URLs
and unguarded unreleased entries. A rollback that closes public admission must
also mark the affected catalog entry `launchState: "security_review"` and update
the reviewed release-admission expectations (the current release pins four
admitted demos in registry and catalog acceptance tests). Changing
only `domainReady` to false remains a supported top-level fallback.

Regression checks now request every admitted detail page and its local artwork,
verify home/catalog discoverability and sitemap inclusion, and require the
launcher back action to reach the actual game heading instead of accepting a
matching URL that rendered 404. Existing pending/verified-domain fixture modes
continue to run independently of production.
