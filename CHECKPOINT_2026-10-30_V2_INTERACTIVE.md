# SOFT TECH — V2.0 INTERACTIVE REDESIGN CHECKPOINT

**Checkpoint date:** 2026-10-30 (Asia/Jakarta)  
**Project:** SOFT TECH / BEYOND PLAY  
**GitHub:** https://github.com/9dbit/Soft-Tech  
**Railway production:** https://soft-tech-web-production.up.railway.app  
**Design release commit:** `fa006a61cdeaf7944c395a9989f6aae84d417ec3`  
**Railway release:** `bea4a6ff-457e-4b2f-b05e-07718e630246`  
**Observed deployment status:** `SUCCESS`  

## Project intent

Redesign the V1 game-provider corporate site into a premium, cinematic, interactive Soft Tech experience. Keep the supplied original neon Soft Tech logo and the existing three external game engines intact. Add true multi-layer parallax, smooth 3D carousel transitions, responsive hover cards and scroll-triggered entrance motion.

## V2 shipped components

### Homepage
- Editorial hero with **BEYOND PLAY.** gradient brand typography.
- Dark atmospheric global backdrop with subtle grain, glowing colored orbs and precision grid.
- Sticky frosted top header and refined left navigation with active state.
- Cinematic **3-card stacked poster gallery** for Skygate 5000, UNO LUCK and Mahjong Wild.
- Active poster highlighted at center, neighboring posters tilted in perspective, with prev/next controls, progress markers, keyboard left/right navigation and a timed carousel.
- Animated game-specific aura and soft-focus artwork backdrop.
- Pointer-driven parallax for hero artwork, orbit rings and depth layers.
- Dedicated Play Demo and Explore Game controls.
- Animated kinetic text marquee.
- Three 3D tilt game cards with cursor-following lighting, light sweep and textured hover zoom.
- Studio identity scene with orbiting visual rings and original Soft Tech logo.
- Studio philosophy and technology highlights.

### Inner pages
- Game catalog with search and genre filters.
- Individual game detail pages with cinematic background, floating secondary artwork and demo launches.
- Redesigned Company, Technology, Partners and Contact pages.
- Contact page provides **copyable enquiry draft only** until a verified company mailbox is configured.

### Motion & accessibility
- Pointer parallax updated with `requestAnimationFrame`; resets when pointer leaves.
- Hover tilt driven by CSS custom properties `--tilt-x` and `--tilt-y`.
- Scroll reveal via `IntersectionObserver`, one-shot observation and GPU-friendly transforms.
- Responsive layouts tuned for large desktop, tablet and 680px/380px mobile widths.
- Reduced-motion preference turns off continuous carousel, loop animation, parallax movement and kinetic transitions.
- Keyboard, accessible control labels and focus-visible states included.
- User interactions on touchscreens do not trigger mouse-specific parallax.

## Source files updated

- `src/components/portal.tsx`: redesign of the full portal and all pages.
- `src/components/motion.tsx`: new reusable motion primitives (ScrollProgress, Reveal, ParallaxScene, TiltCard).
- `src/app/globals.css`: complete responsive visual system, posters, parallax and smooth animations.

## Brand assets & demos

Assets stay local in `public/assets/`, including the verified original Soft Tech logo and artwork from the company's three game repositories.

- **Skygate 5000:** https://skygate-web-production.up.railway.app/play/?utm_source=softtech
- **UNO LUCK:** https://uno-luck-v1172-qa.onrender.com/?utm_source=softtech
- **Mahjong Wild:** https://mahjong-legend-web-production.up.railway.app/?utm_source=softtech

Original game engine source code, betting mechanics, and standalone deployments were not modified. Portal launches are ordinary external links.

## QA evidence

1. Railway Next.js 16.4.3 production compilation: **PASS**
2. TypeScript check: **PASS**
3. Static route generation: **PASS**
4. Production deployment status `SUCCESS`
5. `/api/health`: **Healthcheck succeeded [1/1]**
6. Railway service: **Online**, 1 running replica, 0 crashed
7. Railway notifications: **0 active warnings / 0 critical**
8. Twelve code-structure checks: **12/12 passed** (parallax, carousel, tilt, reduced-motion, catalog, games, mobile, assets, safe contact, no game engine modifications)
9. External game pages were readable in open browser tabs. This verifies the demos are present, **not** a full gameplay or CTA click-through session.

## Known limitations / verification still needed

- Full interactive **visual QA with browser screenshots** across desktop, iPhone 15 Pro, and Android has not been performed in Chat mode. Check typography, poster crops, motion performance and card overflow on real devices.
- Business contact remains a copy-to-clipboard enquiry template until a verified studio email address exists.
- Accessibility includes reduced-motion, keyboard-friendly controls and labels, but no full WCAG audit has been performed.
- Fine-tune 3D card composition based on real-device feedback and in-browser screenshots.
- No new backend, accounts, database or payment capability were introduced.

## Follow-up recommendation

Run browser-based visual inspection in Work mode: 1440px desktop, 1024px tablet, iPhone 15 Pro, narrow Android and prefers-reduced-motion. Verify three Play Demo links and consider unique optimized standalone portrait promo art for each flagship title.

**Result:** Soft Tech V2 interactive redesign shipped to GitHub and deployed on the existing Railway production service.
