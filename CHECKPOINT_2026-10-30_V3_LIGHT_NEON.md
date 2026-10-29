# SOFT TECH — V3 LIGHT NEON REDESIGN CHECKPOINT

**Date:** 2026-10-30 (Asia/Jakarta)  
**Project:** SOFT TECH / BEYOND PLAY  
**Repository:** https://github.com/9dbit/Soft-Tech  
**Production URL:** https://soft-tech-web-production.up.railway.app  
**Source release commit:** `5d5821b4685a22490b44d03d873711f11cfc6ff7`  
**Railway deployment ID:** `2e52c192-fd6f-44d6-be44-5354ced97d70`  
**Environment:** `production`  
**Deployment status observed:** **SUCCESS**  
**Healthcheck `/api/health`:** **PASS** ([1/1] Healthcheck succeeded)  
**Service status observed:** **Online** (1 running replica, 0 crashed, 0 active warnings or critical issues)

## Objective

Replace V2's navy-gradient dashboard identity with a lighter, striking premium game-provider aesthetic. Use **5% neutral grey**, original multicolor Soft Tech logo, energetic **cyan/blue/magenta/pink neon**, more appealing contemporary typography, and a redesigned editorial layout while retaining parallax, card tilt and smooth animations.

## Design system

| Token | Value | Application |
| --- | --- | --- |
| Canvas | `#F2F2F3` | Global 5% grey background |
| Surface | `#FFFFFF` | Floating nav, cards, footer, forms |
| Ink | `#17141E` | Primary text |
| Cyan | `#46C5FF` | Gradient start / focus |
| Blue | `#6E82FF` | Electric blue |
| Magenta | `#C940E3` | Spectrum center |
| Neon Pink | `#FA4FB5` | Spectrum end |
| Headline | Outfit 700/800/900 | Editorial display, game names |
| Body | Plus Jakarta Sans 400/500/600/700/800 | Navigation, descriptions, UI labels |

Signature logo gradient:
```css
linear-gradient(110deg,#46c5ff 0%,#6e82ff 28%,#c940e3 60%,#fa4fb5 100%)
```

**No navy gradient is used for the primary canvas or application surfaces.** Dark color is limited to legible CTA surfaces and the original game artwork with neutral translucent overlays.

## Major UI changes

### Header & navigation
- Removed always-visible navy desktop sidebar.
- Introduced full-width horizontal navigation with editorial spacing.
- Original transparent SOFT TECH neon logo, displayed without stretching inside a compact dark neutral backing plate.
- Floating frosted-white header and interactive active-link states.
- The sidebar is retained only as a responsive slide-out drawer on smaller screens.

### Homepage
- Two-column hero combining "BEYOND PLAY." editorial typography and the interactive game showcase.
- Large **Outfit** display typography and spectral title gradient.
- 5% grey / off-white canvas with controlled pink–magenta–blue radial light.
- Active game selectable through three original-artwork mini-cards.
- Existing 3D stacked poster carousel maintained, with brighter pink/blue lighting and gentle parallax.
- Thin neon accent markers, bright white and black high-contrast buttons.
- Kinetic horizontal brand marquee restyled for light mode.

### Game collection
- Staggered editorial grid on desktop.
- Bright game cards with original artwork, responsive 3D hover tilt, translucent shine and neon hover strokes.
- The first card becomes a wide featured presentation on narrow screens.
- Search, category filters and PLAY DEMO remain functional on the Games page.

### Company, technology & contact
- Light high-key cards with black typography and neon accents.
- Brand spectrum orbit visual on a light studio canvas.
- Partner, technology and contact page surfaces aligned to the V3 palette.
- Contact form still drafts a copyable enquiry; **no fake mail delivery claims**.

### Typography & interaction
- New font pairing: **Outfit** display and **Plus Jakarta Sans** body.
- Cursor-following parallax, layered game posters, card tilt, scroll reveal and keyboard carousel controls retained.
- CSS responsive adjustments at 1470, 1140, 1040, 930, 730 and 420px.
- Existing `prefers-reduced-motion` safeguards retained.

## Modified files
- `src/components/portal.tsx`: horizontal navigation, official-logo header, split hero, interactive quicklinks.
- `src/app/light-ui.css`: light color system, fonts, component restyling and new editorial layout.
- `src/app/light-responsive.css`: tablet, phone and reduced-motion adjustments.
- `src/app/layout.tsx`: ordered imports so V3 styling wins over V2 legacy styles.

## Preserved assets & demos
The original Soft Tech logo and game artwork remain locally bundled in `public/assets/`. No original game engine was modified.

1. **Skygate 5000**: https://skygate-web-production.up.railway.app/play/?utm_source=softtech
2. **UNO LUCK**: https://uno-luck-v1172-qa.onrender.com/?utm_source=softtech
3. **Mahjong Wild**: https://mahjong-legend-web-production.up.railway.app/?utm_source=softtech

## Validation evidence
- Latest deployment `2e52c192-fd6f-44d6-be44-5354ced97d70` observed **SUCCESS**.
- Railway build: Next.js 16.4.3 Turbopack compilation passed.
- TypeScript validation and static route generation passed.
- Railway healthcheck succeeded at `/api/health`.
- 14 focused code checks passed (palette, fonts, imports, hero, navigation, motion, mobile, games, service health).
- Railway service observed **Online**, one replica running, zero crashed.

## Not yet verified

Interactive visual screenshots on real desktop/mobile browsers were not captured in this Chat mode checkpoint. A dedicated browser QA pass should inspect:
1. Hero card alignment and text wrapping at 1440, 1024, 768, 390 and 375px.
2. Contrast and glow balance of the official neon logo on light surfaces.
3. Pointer tilt and carousel ease on desktop, touch scroll on phones.
4. All direct PLAY DEMO click-throughs and contact copy interaction.

## Next checkpoint

Browser screenshot QA, visual polish from actual rendered frames, optional local optimization of the two Google Font families, and business enquiry integration once an official mailbox is available.

**Result:** V3 light grey / neon spectrum redesign implemented, pushed and deployed to the existing Railway production service.
