# SOFT TECH / Production V4 Typography & Layout Recovery
Checkpoint: 2026-11-02
Repository: https://github.com/9dbit/Soft-Tech
Production URL: https://soft-tech-web-production.up.railway.app/

## User-reported regression
An overly broad CSS rule replaced all h1-h6 typography and line-height with pixelated font settings, disrupting the V4 hero's absolutely positioned BEYOND / PLAY lettering, featured game title, poster art and descriptions. The original logo also had a black CSS plaque.

## Implemented on main
- Commit `76cc01b170ca8577310b9014c7783cbad787342a`: remove the appended global V4 responsive font overrides; replace `src/app/typography.css` with scoped headline styles; commit the user-supplied Minecraft font as `public/fonts/softtech-minecraft.woff2` (subset/converted from Minecraft.ttf).
- Commit `11dd6a3c95f589b16a218c7afbc7b6791f693fd0`: remove conflicting decorative PLAY word, lower background typography opacity, keep game poster title unobstructed on mobile, and position hamburger on far right.
- `scripts/qa-production-layout.mjs` plus `.github/workflows/production-layout-qa.yml`: production-mode Next.js build, Chromium screenshots and responsive geometry checks, font loading and scroll/reveal coverage.
- Commit `1c1f6921750d758e2eaa280b9b72cd282ea7ddf9`: scroll every Reveal section before screenshot capture; fail if hidden sections remain.

## Verified deployment
Railway project 0e6f5bdf-8437-41e1-a709-b42476cd143e
Railway service soft-tech-web c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1
Production environment 9d39a708-0653-4d6c-9f88-d1e730833492
Production UI commit `11dd6a3c95f589b16a218c7afbc7b6791f693fd0`
Railway deployment `4da61970-1cea-44fd-b5c6-b7766dd1bf93`: SUCCESS.
Documentation/QA-only commits were SKIPPED by Railway's source path filter as intended.

## Browser QA
Final automated browser QA run: https://github.com/9dbit/Soft-Tech/actions/runs/41346295621
Result: SUCCESS, 0 script errors.
- Real Chromium browser with local production build.
- Desktop 1440, 1920; tablet 768; iPhone 390, 360.
- Minecraft WOFF2 served with HTTP 200 and one loaded font face.
- Pixel font used on featured headline and NOT MADE TO FIT editorial heading.
- No horizontal overflow across tested viewports.
- Header logo has transparent background.
- Mobile hamburger positioned to the right of language selector; no overlapping logo.
- All 15 animated Reveal sections observed and displayed on each tested viewport.
- Screenshots for 5 home viewports plus Games, Company, Technology, Partners and Contact.
- Screenshot artifact name: `soft-tech-production-layout-qa`.

## Visual acceptance
Production V4 hero is now legible again, with featured game title and artwork in distinct areas, medium grey Minecraft editorial heading, monospace paragraph copy, and no black logo plaque. The 3D orange-computer V5 preview remains a separate branch/environment and was not merged into production.

## Follow-up
- User visual signoff on actual iPhone and desktop browser.
- Any subsequent V5 design migration should first merge through the verified visual QA workflow instead of applying broad CSS overrides to main.
