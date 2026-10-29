# SOFT TECH — Production Checkpoint
**Timestamp:** 2026-10-30 (Asia/Jakarta)  
**Release:** V1.0 — Beyond Play  
**Repository:** https://github.com/9dbit/Soft-Tech  
**Branch:** `main`  
**Deployed code commit:** `b4d3ecaeb9b893845937f39de1832bd891cb056e`  

## 1. Production evidence
- **Railway project:** `0e6f5bdf-8437-41e1-a709-b42476cd143e`
- **Production environment:** `9d39a708-0653-4d6c-9f88-d1e730833492`
- **Service:** `soft-tech-web` / `c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1`
- **Live URL:** https://soft-tech-web-production.up.railway.app
- **Successful deployment ID:** `ca1e6ff6-b5c7-4233-977e-2d52252fcecf`
- **Observed deployment status:** `SUCCESS`
- **Healthcheck:** `/api/health`, **Healthcheck succeeded [1/1]**
- **Runtime:** Next.js 16.4.3 on Railway Node.js, listening on `0.0.0.0:8080`
- **Replicas:** 1 running / 0 crashed
- **Active warning / critical notifications:** 0 / 0

## 2. Security & dependencies
- Deployed `next@16.4.3`, `react@19.3.1`, `react-dom@19.3.1`.
- Railway install log: **`found 0 vulnerabilities`** across 32 audited packages.
- First deployment was blocked because `next@15.5.0` had critical security advisories. Repaired and upgraded to active-LTS Next 16.
- Repository contains no production secrets or credentials.

## 3. Branding & artwork
The exact attached SOFT TECH neon logo was verified against `9dbit/Skygate/play/assets/splash/soft-tech.png` by matching Git blob SHA:
`70c41c2c9ffa5e724edab559dad9fd41e3fc12d8`.
Six branded artwork files were imported directly into `public/assets/`, removing the runtime dependency on source-repository raw image URLs:
- `public/assets/soft-tech-logo.png` — original full logo, untouched
- `public/assets/skygate-cover.jpeg`
- `public/assets/uno-luck-cover.webp`
- `public/assets/uno-luck-detail.webp`
- `public/assets/mahjong-cover.jpg`
- `public/assets/mahjong-detail.webp`

## 4. Implemented user journeys
- Home: cinematic featured-game carousel, animated hero, original game cards, brand narrative.
- Our Games: searchable catalog with category filters.
- Game detail pages: Skygate 5000, UNO LUCK, Mahjong Wild.
- Corporate: Company, Technology, Partnerships, Contact.
- Navigation: responsive desktop sidebar, mobile drawer, visible mobile wordmark.
- Language: EN/ID selection in the client.
- Routing: valid detail URLs and custom 404 for unknown paths.
- SEO: page metadata, Open Graph, sitemap, robots.
- Accessibility: semantic controls, labels, reduced-motion CSS.
- Demo launches: external direct links, no game engine migrations or modifications.

## 5. Game demo links
1. **Skygate 5000:** https://skygate-web-production.up.railway.app/play/?utm_source=softtech
2. **UNO LUCK:** https://uno-luck-v1172-qa.onrender.com/?utm_source=softtech
3. **Mahjong Wild:** https://mahjong-legend-web-production.up.railway.app/?utm_source=softtech

These URLs have been checked in source configuration. **Independent uptime and gameplay interaction tests for these three external deployments were not completed in this checkpoint**, since the external-site fetcher could not reach them; the SOFT TECH website itself passed Railway healthcheck.

## 6. QA performed
- Railway Next.js 16.4.3 Turbopack compilation: **PASS**
- TypeScript validation: **PASS**
- Static route generation: **PASS**
- npm audit output: **0 vulnerabilities**
- Runtime healthcheck: **PASS**
- Service deployment status: **SUCCESS**
- Repository static checks: **10/10 PASS** for local logo, local art, navigation paths, official game links, mobile wordmark, reduced-motion, search, no deposit/withdrawal flow, health endpoint, and SEO.
- Visual/browser QA on physical mobile devices: **not yet verified**; perform on iPhone and Android to validate image crops, touch targets, and animations.

## 7. Known deliberate limitations
- Business contact does not send emails yet; the form provides a copyable email template until an official recipient address is configured.
- No account registration, operator portal, financial transactions, or casino wallet.
- Preview assets are still a curated selection from existing game repositories; art direction can be enhanced in a visual polish checkpoint.
- A dedicated square app icon and social preview may improve upon the current full-width official logo.

## 8. Recommended next checkpoint
1. Visual QA: desktop, tablet, iPhone 15 Pro, Android; screenshots and fixes where necessary.
2. Verify three external demo URLs inside a normal interactive browser.
3. Add real official company contact mailbox, gated partner enquiry workflow and privacy/legal pages.
4. Produce bespoke game cover and promotional banners from approved source artwork.
5. Add a custom SOFT TECH domain once owner confirms preferred domain.

**Status:** V1.0 public showcase deployed, running and verified through Railway. Business inbox and external game playtesting are pending separate verification.
