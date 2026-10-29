# SOFT TECH • BEYOND PLAY

## V2 Cinematic Interactive Showcase

The V2 redesign adds a layered, pointer-reactive 3D flagship carousel, luminous tilt cards, scroll-reveal transitions, adaptive ambient glow and a responsive editorial design system. Smooth motion uses native CSS transforms, `requestAnimationFrame` and `IntersectionObserver`, with a `prefers-reduced-motion` fallback. Production deployment: https://soft-tech-web-production.up.railway.app. See `CHECKPOINT_2026-10-30_V2_INTERACTIVE.md`.
Corporate game provider showcase for the 9dbit studio portfolio, running Next.js 16 and TypeScript.

## Locally
```bash
npm install
npm run dev
npm run build
```

## Railway
Active dependencies: Next.js 16.4.3 and React 19.3.1.\n\nConnect GitHub repository `9dbit/Soft-Tech`, branch `main`, Node 20+, standard Next.js build/start commands. Configure `/api/health` as optional service healthcheck. No database is required for the public showcase.

## Featured demos
- [Skygate 5000](https://skygate-web-production.up.railway.app/play/?utm_source=softtech)
- [UNO LUCK](https://uno-luck-v1172-qa.onrender.com/?utm_source=softtech)
- [Mahjong Wild](https://mahjong-legend-web-production.up.railway.app/?utm_source=softtech)

## Art
Exact Soft Tech logo and game cover assets have been copied into `public/assets/` from the studio-owned repositories (9dbit/Skygate, 9dbit/uno-luck, 9dbit/mahjong-legend). All files are now served by Soft Tech itself; changes to source repo visibility won't break the portal. The logo file is byte-identical to the supplied reference.

## Contact
The site provides a partnership enquiry email template via mailto; no unconfigured server is claimed to deliver emails. A backend contact delivery integration can be added once an official studio mailbox is confirmed.

## Scope
Brand / game discovery / virtual-credit demo launch only. No deposits, withdrawals or money betting.
