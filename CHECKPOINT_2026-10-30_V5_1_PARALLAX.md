# SOFT TECH V5.1 — DESKTOP PIXEL MATCH & DEEP PARALLAX

**Checkpoint date:** 2026-10-30 (Asia/Jakarta)  
**Repository:** https://github.com/9dbit/Soft-Tech  
**Branch:** `feat/v5-desktop-pixel-match-20261030`  
**Pull request:** https://github.com/9dbit/Soft-Tech/pull/1 (Draft)  
**Approved master:** `soft_tech_pixel_game_studio_hero.png` — 1586 × 992 pixels, user-provided  
**Preview:** https://soft-tech-v5-preview-production.up.railway.app/  
**Production V4:** https://soft-tech-web-production.up.railway.app/ (UNCHANGED)

## Release status

**V5.1 is implemented on the isolated PR branch and running on an isolated preview SERVICE.**
The preview service `soft-tech-v5-preview` is in the same Railway project and **production-named environment** as V4, but is a different service and has a separate *.up.railway.app domain. It is NOT a new staging environment. Its GitHub source is pinned to the V5 branch/commit.

No merge of this PR to `main` has been performed. The original V4 production service `soft-tech-web` continues on `main`.

## Completed: Phase A — original 3D computer assets
- Uploaded original user-supplied retro orange computer cutout (1024 × 1536 RGBA) into `public/assets/v5/orange-computer-cutout.webp`.
- Uploaded independent, transparent monitor, keyboard, printer, cable, cartridge and cursor layers to `public/assets/v5/`.
- Original cropped neon Soft Tech logo used directly in header: `soft-tech-neon-header.webp`.
- Iterative cable-alpha repair: continuous lower return coil reconstructed from original photo, anti-aliased; keyboard layer remasked to avoid duplicate orange cartridge fragment and reduce the most visible beige matte.
- CSS vector fallback is only rendered if the primary image fails to load.
- Do not claim all pixels are identical to the 3D master asset: some translucent edges/ambient shadows remain approximate.

## Completed: Phase B — desktop editorial composition
- Rounded 5% grey visual system, dark text, orange accents.
- Soft Tech official logo, long center-aligned segmented navigation pill, prominent but truthful Login/Register partner-access notice.
- Asymmetric four-line BUILDING / DIGITAL / GAME WORLDS / THAT STICK typography.
- `3 FLAGSHIP GAMES` stat on right, oversized pixel words `SOFT` / `TECH` behind artwork.
- Original orange computer and its accessories shown in independently depth-aware layers; CTA pair, social icons and bottom scroll cue remain positioned against reference.
- Fine alignment tweaks from real screenshot QA: master stage x=30/y=20, headline x≈82/y≈196, nav x≈438/w=644, central computer x≈589/w≈569.
- Desktop is specifically optimized for 1586 × 992; alternate 1366, 1440, 1920 checked for responsive overflow.
- Phone 390 uses retained V4 homepage to avoid disruption.

## Completed: Phase C — animation
- RAF-limited pointer parallax with bounded offsets unique for six layers.
- Scroll depth offset and eased CSS perspective shifts.
- Independent floating sticky note, smiling sphere and orange ring loops.
- Respects native vertical scroll, reduced-motion preference and touch/mobile fallback.
- Transparent asset-loaded readiness sync handles early network/image completion before React hydration.
- All core buttons, including Explore Games and partner dialog, tested through browser automation.

## Automated QA
- GitHub workflow: `.github/workflows/v5-desktop-qa.yml`.
- Full Next.js build and TypeScript validation in GitHub Actions.
- Playwright full-browser screenshots and JavaScript exception checks on five viewports: 1586×992, 1440×900, 1366×768, 1920×1080, 390×844.
- Verifies all six layer assets have nonzero naturalWidth; tests full image readiness, zero horizontal page overflow, correct breakpoint routing, Explore Games CTA, partner dialog open/close.
- Baseline successful QA: https://github.com/9dbit/Soft-Tech/actions/runs/40993603722.
- Design-polish QA successful: https://github.com/9dbit/Soft-Tech/actions/runs/40994912164.
- Latest QA (for asset de-duplication): https://github.com/9dbit/Soft-Tech/actions/runs/40995269575. Verify latest terminal status before claiming final release.
- Screenshots attached as artifact `soft-tech-v5-desktop-visual-qa` to runs.

## Remaining before merge to production
1. Visual approval of screenshot at 1586 × 992 against original master. Automated QA is a functional pass, **not** proof of 100% pixel-perceptual equality.
2. Confirm depth animation is smooth on real iPhone Safari and Chrome desktop, including motion-reduced settings.
3. Improve miniature decorative 3D orange sphere/sticky-note fidelity if an exact original asset is supplied; current CSS-rendered decorations remain approximate.
4. If needed, retouch beige edge matte on printer paper and coiled cord at 2× zoom.
5. Only after approval, decide whether to merge V5 to `main` and deploy the V4 production service.

## UI architecture

- `src/components/v5-desktop-hero.tsx`: real React interactions, six-layer image parallax, functional demo navigation.
- `src/app/v5-desktop.css`: master coordinates and responsive corrections.
- `src/components/portal.tsx`: V5 desktop mount with V4 mobile fallback.
- `scripts/v5-visual-qa.mjs`: reproducible screenshot and interaction regression tool.
- `.github/workflows/v5-desktop-qa.yml`: build + browser QA + uploaded artifacts + PR report.
- `public/assets/v5/`: owner-provided orange-computer and Soft Tech logo assets.

**Policy:** do not merge draft PR or change the `soft-tech-web` production service without completing visual review. 
