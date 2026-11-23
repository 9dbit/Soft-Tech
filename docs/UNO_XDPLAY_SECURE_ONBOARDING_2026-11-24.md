# XDPLAY / UNO LUCK: Secure Domain Onboarding
**Date:** 2026-11-24 (WIB)  
**Source pin:** `9dbit/Soft-Tech` deployed `rebrand/xdplay-public-20261112` at `3efa1471dc48407b8d3eb6d031b64b851f2a7894`  
**Candidate branch:** `security/xdplay-uno-domain-onboarding-20261124`  
**Change category:** marketing portal / domain routing, not game engine.

## User-facing contract
- Keep `https://xd-play.com/` as the canonical XDPLAY portfolio and current working website.
- Show `UNO LUCK` game details at `https://xd-play.com/games/uno-luck`; preserve its branded artwork, mobile/desktop layout and other game links.
- A reserved `uno.xd-play.com` host **redirects to the canonical non-launch detail page**, not to any wallet, QA engine, external Render URL or unreviewed game.
- Set UNO `launchState = security_review`; replace every standalone Play Demo button with a noninteractive disabled Security Review status on desktop/mobile/alternate hero.
- Remove the retired external Render QA launch URL. Other games retain their exact existing links and status.
- Public `GET /api/games/uno-luck/status` reports launch/purchases/redemption disabled, with `Cache-Control: no-store`.
- Noindex the not-yet-approved UNO game details and omit it from the sitemap until release sign-off.

## Web security
- Existing apex `xd-play.com` was VERIFIED with a VALID TLS certificate in Railway at audit time. `www.xd-play.com` certificate was also VALID but provider DNS report said REQUIRES_UPDATE; handle separately, without breaking apex.
- Add no-sniff, referrer, frame protection, minimal frame-ancestors/object/base CSP, restrictive Permissions-Policy and short initial HSTS max-age **without includeSubDomains**, because other XDPLAY hosts have independent security states.
- DNS: do not edit apex or www records. Add only `uno` CNAME once Railway provides the precise target and the owner confirms the DNS-control plane (Cloudflare or equivalent). Revalidate Railway `verified` and certificate VALID before sharing the final custom-domain link as ready.
- If a DNS connector is unavailable, stop at registration, give the exact required CNAME, and clearly report that the domain is not yet live.
- Never attach the vanity domain to `softtech-prod-uno`, `uno-luck-web`, a wallet, or a game staging service before full production qualifications.

## Source/deployment safety
- No changes to `9dbit/uno-luck`, `9dbit/Genesis`, `9dbit/Playground`, core signing keys, backups, payout, bet odds, coin balances or sound files.
- Do NOT accept the already staged 24-change patch on the production UNO provider service as part of domain onboarding.
- Gate via Next build, static and browser QA, previous source integrity hashes for unchanged assets; deployment only after verified readiness.
- Source-based preview and marketing onboarding do not certify real-value gaming. Legal, mathematics and independent security gates from UNO PR #37 remain NO-GO.
- Keep exact rollback deployment pin `3efa1471dc48407b8d3eb6d031b64b851f2a7894` until safe candidate validation finishes.

## QA evidence paths
- `scripts/uno-secure-onboarding.test.mjs`: confirms disabled UNO CTA, safe host, headers, release state.
- `scripts/xdplay-public-qa.mjs`: full portfolio desktop/mobile browser checks, canonical and host redirects and closed UNO launch.
- `.github/workflows/uno-secure-onboarding.yml`: isolated test runner and browser screenshot artifacts.
