# Game Factory premium image asset production contract

Status: PROPOSED V2. These are explicit engineering acceptance criteria; the existing V1 import handles SVG placeholder symbols and is not a high-fidelity WebP compositor yet.

## Art pipeline
1. **Creative brief and research:** classify genre, references, story, approved visual DNA, legal provenance, art direction, portrait and desktop crop/safe area.
2. **Concept selection:** generate two original key-visual concepts and record the chosen master and its SHA-256. A flattened key visual serves only as a comparison and composition reference.
3. **Separate asset generation:** 9:16 and 16:9 clean backgrounds, character/hero, independent logo, reel/wheel architecture, each symbol/card, normal/gold/selected/disabled variants, individual HUD/control frames, special effects and celebration screens. Export RGBA transparent WebP/PNG masters with no baked numeric values.
4. **Asset manifest:** stable semantic IDs and source paths, original source hash, export dimensions/alpha, role, state, platform, crop and z-order. Keep approved reference, clean version and derivatives in separate paths.
5. **Visual audit:** alpha coverage, minimum dimensions, seam/halo inspection, consistent materials, perspective, lighting and legibility; isolated button hitboxes >=44 CSS px, real phone safe areas, reduced motion.
6. **Studio reconstruction:** first-class raster assets, scene-group z-order, sprite-atlas source windows, per-asset visual replace, image preview variants, independent live text, source hash and rollback.
7. **Playable proof:** bind non-financial UI events to a replayable demo engine. A screen mockup is not gameplay. Actual server result needed for financially consequential outcomes.
8. **Signoff:** art approval is distinct from engine/RNG/wallet/production release. Keep production gate BLOCKED.

## Minimum roles for original slot art
- backgrounds: portrait and desktop, no baked controls or text
- hero or environment focal component; logo/title
- reel frame front/back where occlusion applies
- all non-reused symbols, plus separate WILD and SCATTER, with consistent size and lighting
- SPIN, AUTO, TURBO, minus/plus, menu/audio and their relevant visual states
- HUD ornament without baked credit/bet/win numbers
- win, free spins, special effect and celebration overlays
- portrait and desktop layout constraints, including mobile PWA safe areas
- favicon, app touch/PWA maskable icon, Telegram OG generated from final approved art

## Contract and test levels
- A **WIREFRAME** generated with letter/emoji/SVG placeholders is permitted only for engine smoke tests and layout discussion.
- An **ART_CANDIDATE** has independent real PNG/WebP sources and passes structural inventory checks; appearance and rights still require human review.
- **ART_APPROVED** requires signed-off visual master and tested raster derivatives with provenance.
- **STUDIO_READY** requires fidelity of the imported scene, asset replacement/reopening, responsive screenshots and visual tests of actual gameplay.
- **PRODUCTION** always remains blocked until separate math/RNG/wallet/security/legal/approver gates pass.

## Required Studio V2 functions
- Source reference and style-locked visual history beside AI image prompts/variants.
- Native PNG/WebP transparent import and separate source/master/optimized derivative records; no forcing full image into a tiny SVG data URI.
- Image-generation action on a **selected layer** that preserves other approved assets and the game-math hash.
- Crop/contain/cover/rotate/occlusion/mask, source sprite windows, transforms, z-order and responsive constraints.
- Per-state preview (idle, pressed, disabled, win, bonus, active) and event binding.
- Diff against approved portrait/landscape screenshots, user-controlled art signoff, rollback, and explicit missing-art warnings.

Implementation staging order: portable asset contract + receipt, then Studio raster/sprite pipeline, then prompt/AI workflow, then approved gameplay reconstruction. Do not replace current staging until isolated CI and browser QA pass.
