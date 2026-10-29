# SOFT TECH V4 — NEO-DIGITAL PLAYGROUND CHECKPOINT

**Checkpoint date:** 2026-10-30 (Asia/Jakarta)  
**Source repo:** https://github.com/9dbit/Soft-Tech  
**Branch:** `main`  
**Production URL:** https://soft-tech-web-production.up.railway.app  
**V4 final code commit:** `1b3518bd8e6444e3f30b5fbecf4bf2812a7a0012`  
**Railway project:** `0e6f5bdf-8437-41e1-a709-b42476cd143e`  
**Environment:** `9d39a708-0653-4d6c-9f88-d1e730833492` / production  
**Service:** `c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1` / soft-tech-web  
**Final deployment:** `2de19ca9-621a-4b9a-9f06-8185bd6f013d`  
**Release status:** **SUCCESS / ONLINE**

## Release objective

Translate the three approved design references into a custom, premium interactive digital-studio website, combining 45% editorial minimalism, 35% retro 3D digital playfulness and 20% cinematic game futurism.

Primary canvas remains `#F2F2F3`. Neon cyan, blue, magenta and pink are used as restrained lighting and interaction accents. No navy gradient.

## What changed

### Editorial hero (new)
- Full-bleed oversized **BEYOND PLAY.** letterforms with a one-time mask reveal.
- Large 3D perspective game poster with soft shadow and layered, mouse-reactive depth.
- Floating pixel-style technical markers, rings, glows and decorative shapes.
- Actual game artwork for **Skygate 5000**, **UNO LUCK**, and **Mahjong Wild**.
- For UNO LUCK: separate floating original dragon-wheel ornament.
- For Mahjong Wild: actual transparent dragon and WILD tile sourced from owner-controlled Mahjong game assets.
- Featured game's title, genre, description and two real CTAs (PLAY DEMO and DISCOVER).
- Three progress selectors, prev/next arrows, keyboard navigation and auto carousel.
- Supports touch swipe on horizontal gestures while preserving vertical page scroll.

### Typography & palette
- Display: **Barlow Condensed** bold/black for large editorial headlines.
- Body: **Manrope**.
- Micro-labels: **DM Mono**.
- Pixel accents: **Pixelify Sans**.
- Color tokens and interaction rules: `DESIGN_SYSTEM_V4.md`.
- Dark charcoal for readable type and selected CTAs, not a dark/navy site background.

### Scrolling and game presentation
- Preserved 3D cursor-follow tilt cards and kinetic ticker.
- Added **sticky scroll storytelling** section: `NOT MADE TO FIT. MADE TO FEEL.`
- Three large, cinematic, game-specific panels with legitimate details and navigation.
- Existing Company, Technology, Partners, Contact and three individual game detail pages retained.

### Animation system
- `requestAnimationFrame`-limited pointer positions with CSS length-valued custom properties for cross-browser compatibility.
- Magnetic CTA motion and hover glow.
- One-time headline mask entrance and studio scroll reveal via `IntersectionObserver`.
- Auto carousel approximately 9 seconds, paused on hover or `prefers-reduced-motion`.
- Swipe threshold 58px with direction dominance check to protect native vertical scrolling.
- Keyboard arrow support and conventional tap/click controls.

### Preserved gameplay and routing
- No game engines changed, and no direct code changes to Skygate, UNO LUCK or Mahjong.
- Live demo URLs are preserved in `src/data/games.ts`.
- External demo links use `noopener noreferrer`.
- No deposit, withdrawal or real-money betting features were added.
- Contact page still provides an honest copyable enquiry draft pending confirmation of the official business mailbox.

## New / changed files
- `src/components/v4-playground.tsx`: new V4 hero and game-world scrolling narrative.
- `src/app/v4.css`: editorial design, motion, effects and new light-neutral palette.
- `src/app/v4-responsive.css`: mobile/tablet adaptations.
- `src/components/portal.tsx`: replaces V3 hero and mounts V4 story while preserving routes.
- `src/app/layout.tsx`: imports V4 CSS last.
- `public/assets/mahjong-dragon.webp`, `mahjong-wild-tile.webp`, `mahjong-logo.webp`: local exact copies from official Mahjong source.
- `DESIGN_SYSTEM_V4.md`: design tokens and interaction specification.
- `README.md`: release overview.

## Verified QA evidence
- Railway status: **SUCCESS** for final code commit `1b3518bd...`.
- Next.js 16.4.3 production build compiled successfully; TypeScript validated.
- Static route generation successful (6/6).
- Healthcheck: **[1/1] Healthcheck succeeded** on `/api/health`.
- Service status: **online**, 1 replica running, 0 crashed.
- Railway active issue counts: **0 warnings / 0 critical**.
- Repository static checks before final animation polish passed **18/18** (V4 mount, typography, palette, active game links, motion, mobile and reduced-motion). The two final gesture/mask updates subsequently compiled successfully.

## QA not yet completed
- **Real visual screenshot inspection** at 1440px, 1280px, 1024px, 768px, iPhone 15 Pro and Android 360px has not been performed in Chat mode. Build success does **not** independently verify pixel-perfect geometry, legibility, or motion smoothness.
- In-browser manual click-through of all three external games after this exact V4 deployment was not performed.
- Core Web Vitals, external font-load timing, Safari on-device gesture accuracy and comprehensive accessibility audit remain to be measured.

## Recommended next QA checkpoint
Open the production site in a visual browser and inspect the actual rendered experience, especially the BEYOND PLAY overlap, poster crop, magnetic hover and swipe on narrow screens. Correct any visual collisions and record before/after screenshots.

**Result:** SOFT TECH V4 source committed and production release verified healthy on the existing Railway service.
