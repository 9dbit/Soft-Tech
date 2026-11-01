# SOFT TECH V6.1 - UI LOCKED, MINECRAFT HEADINGS & MONOSPACE CONTENT LIVE

Date: 2026-11-02 (Asia/Jakarta)

## Approved UI baseline
- UI baseline: `d72a61059e69437eda7308e3c7df6df0fe978b63` (V6.1 full-bleed orange-computer + six-layer deep parallax + universal desktop navbar).
- Production release branch: `feat/v61-minecraft-mono-uilock-20261102`.
- **Pinned production commit**: `621ff2618f288569f4ba5072ce7f22ba26e282b8`. This does not follow moving branch pushes.
- Original stage/hero components, game assets and CSS framework are protected with the Git blob hash verifier `scripts/verify-ui-lock.mjs`: 28 lock entries.
- Layout/animation files and navbar CSS were NOT edited for this typography update.

## Typography
- Source `Minecraft.ttf` supplied by user; exact glyphs/outlines converted to a 3,180-byte WOFF2 webfont as `public/fonts/Minecraft.woff2`.
- Section titles, including main desktop/mobile homepage hero headlines and inner-page headings, use the bundled `SoftTech Minecraft` face.
- Descriptive body copy, paragraph/list text and form copy use native monospace font stacks.
- Existing navbar fonts, buttons, logos and decorative game-cover logotypes remain unchanged.
- Typography is scoped to `src/app/v61-locked-typography.css` loaded after existing V6.1 rules; no broad global `h1/h2` font/layout overrides.
- Responsive typography caps prevent line wrapping collisions while preserving orange-computer composition.

## Automated and visual QA
- GitHub Actions: https://github.com/9dbit/Soft-Tech/actions/runs/41350205807
- Next.js build, typecheck, 28-file UI integrity guard and Playwright responsive QA all SUCCESS.
- 35 checks, 0 errors, desktop/mobile 1440/393 typography checks covering Home, Games, Studio, Technology, Partners, Contact, and game detail.
- Verified original full-width stage remains `x=0, width=1440` at desktop 1440. Original navbar unchanged.
- New Minecraft font face is actually loaded in Chromium, not just declared as CSS fallback.
- Real screenshot artifacts include updated desktop master and mobile hero; both inspected for clipping/overlap and were visually accepted.

## Railway production verification
- Project: `0e6f5bdf-8437-41e1-a709-b42476cd143e`.
- Environment: `9d39a708-0653-4d6c-9f88-d1e730833492` (production).
- Service: `c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1` (soft-tech-web).
- Production deployment: `f109b156-bf58-4e32-806a-3f5d2dd3c891` = SUCCESS.
- 1/1 replica online, 0 crash, 0 warnings or critical notifications.
- Live URL: https://soft-tech-web-production.up.railway.app/
- Preview URL: https://soft-tech-v5-preview-production.up.railway.app/ (same pinned commit, SUCCESS).

## Release policy
Production remains pinned to commit `621ff261...`. Do not re-point to `main` or auto-follow branches, or merge later V6.3/V6.4 global typography overrides. New UI work requires a deliberate guard-manifest change and a passing browser QA before deployment.

Full technical checkpoint on the release branch: `CHECKPOINT_2026-11-02_V61_UI_LOCK_MINECRAFT_MONO.md`.
