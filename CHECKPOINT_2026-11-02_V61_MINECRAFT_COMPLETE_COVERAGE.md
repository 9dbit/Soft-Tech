# SOFT TECH | V6.1 Minecraft Typography Coverage - Production PASS

Date: 2026-11-02 (Asia/Jakarta)
Repository: https://github.com/9dbit/Soft-Tech
Release branch: `fix/v61-complete-minecraft-coverage-20261102`

## User feedback and diagnosed regression
Four user-supplied iPhone screenshots showed missing Minecraft display font on:
- Mobile "OUR FLAGSHIP GAMES" heading and Skygate / UNO / Mahjong card titles.
- "ORIGINAL WORLDS", "IMMERSIVE MOMENTS", "BUILT FOR THE WEB" feature headings.
- Footer Home / Games / Studio / Technology / Partners menu.
- Slide-out navigation names and "PLAY THE UNEXPECTED." promotional title.
- Some desktop game actions and home flagship counters.
Old CSS had `font: ... !important` and high-specificity Nunito / Manrope / Space Grotesk overrides, which earlier CSS did not beat. Some game slogans were also not truly monospace.

## Approved UI preserved
- Original V6.1 full-width 3D orange-computer hero with independent 6-layer parallax.
- Universal floating pill desktop navbar, mobile navigation, game artwork and layouts.
- Base production commit: `621ff2618f288569f4ba5072ce7f22ba26e282b8`.
- 28 UI source and asset hashes continue to be checked by `scripts/verify-ui-lock.mjs`.
- **Only three files changed** from the approved release: `src/app/v61-locked-typography.css`, `scripts/v5-visual-qa.mjs`, and `.github/workflows/v5-desktop-qa.yml`. No artwork, component structure, animation engine or underlying layout CSS changed.

## Typography rules
- The bundled `public/fonts/Minecraft.woff2` uses the exact glyph outlines converted from the supplied `Minecraft.ttf`.
- Minecraft: visible editorial h1-h4, desktop/mobile hero headings, section headers, all game card titles, game category labels, flagship/feature headings, navigation labels in desktop header and mobile drawer, footer navigation, sidebar promo text and prominent action buttons.
- Monospace: paragraph copy, game slogans, list/description text, footer descriptions/legal, counter metadata, and form inputs.
- Responsive pixel font-size caps preserve width in game card, 360px/393px iPhone layouts, sidebar menu and navbar. No page overflow introduced.
- Original brand logo assets and decoration remain unchanged.

## Validation
- GitHub Actions https://github.com/9dbit/Soft-Tech/actions/runs/41351768189: **SUCCESS**.
- Next.js build & TypeScript: SUCCESS.
- V6.1 28-file UI integrity verifier: SUCCESS.
- Playwright browser QA: `V5_QA_FINAL {"viewports":56,"errorCount":0,"errors":[]}`.
- New comprehensive computed-style coverage on Home, Games, Studio, Technology, Partners, Contact, and a game-detail route at widths 360px, 393px and 1440px.
- Sidebar open/close and computed font checks, footer nav, flagship headings and desktop CTA tested.
- Artifact: `soft-tech-v5-2-cross-device-qa` from run 41351768189 includes screenshots and metrics.
- QA is Chromium with simulated mobile viewports, not a physical iPhone Safari device test.

## Production Railway verification
- Project: `0e6f5bdf-8437-41e1-a709-b42476cd143e`.
- Environment: production `9d39a708-0653-4d6c-9f88-d1e730833492`.
- Service: `soft-tech-web` `c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1`.
- **Pinned production commit:** `2dad8bbd89c9e93a556776051961b9a4c51cca97` (not following moving branch).
- Deployment `3e0f34a3-7a6c-48b7-90ca-d3930984b187`: SUCCESS.
- Health: Online, 1/1 replicas, 0 crashes, warnings or critical issues; Next.js running on port 8080.
- Production: https://soft-tech-web-production.up.railway.app/
- Preview: https://soft-tech-v5-preview-production.up.railway.app/ (same source and visually verified).

## Release rule
Do not merge historical broad typography overrides (V6.3/V6.4). Future updates must preserve this UI lock and pass browser QA at mobile 360/393 and desktop 1440, including **computed** Minecraft font family and actual visual screenshot inspection, before pinning a new production SHA.
