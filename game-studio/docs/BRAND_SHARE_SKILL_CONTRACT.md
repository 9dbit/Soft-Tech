# Game Factory Skill: Brand & Share Assets contract (planned)

**Status:** specification for future integration, **not an installed ChatGPT Skill** and **not an implemented backend API**. This file records an approved requirement so it will not be lost when the standalone Studio and later Game Factory Skill are developed.

## Trigger

After a game passes visual design review and is saved in the Studio:

> "Buatkan game Cyber Punk, 5×3 reels, 20 paylines, target RTP 96%; buatkan juga semua favicon, app touch icons, PWA icons, metadata dan Telegram Open Graph image; tampilkan untuk saya review di Studio."

The future Skill must interpret this as an **asset-generation and review request**, not authority to publish production or configure financial logic.

## Mandatory staged flow

1. Read the approved game's brand title, color palette, source artwork, description, target URLs and current version from Studio's persistent project record.
2. Generate original artwork plus an independently addressable icon/social asset set; do not slice a flattened UI mockup to simulate standalone editable assets.
3. Generate and validate favicon SVG + ICO + PNG 16/32, Apple Touch 180 PNG, Android/PWA 192/512 PNG and 512 maskable PNG, and Telegram/Facebook/WhatsApp social Open Graph image in 1200×630 PNG.
4. Generate escaped SEO metadata: `<title>`, description, robots, canonical, theme-color, `og:type`, `og:title`, `og:description`, `og:url`, absolute HTTPS `og:image`, dimensions, `og:image:alt`, and Twitter large-image card. Output `site.webmanifest`.
5. Show **real asset previews** in Brand & Share Studio: browser tab, Apple home-screen icon, Android install preview, OG share card, downloadable asset list and raw HTML tags. Human reviews/revises the images and text.
6. On approval, store individual source assets, generated versions, asset dimensions, checksums, generator settings, approval identity and timestamp. Connect to sandbox game bundle only. Production remains behind a separate release gate.
7. After sandbox hosting, verify the public HTML head, accessible absolute HTTPS OG image, correct content type and image dimensions. Check social preview using real published URLs. Telegram caching and client-specific rendering must be noted; local previews are not proof of Telegram rendering.

## Proposed interfaces (NOT implemented)

- `POST /api/v1/projects/{projectId}/brand-assets/generations` with approved concept version / prompt / target platforms.
- `GET /api/v1/projects/{projectId}/brand-assets/generations/{generationId}` returns statuses, per-asset file refs and validation findings.
- `POST /api/v1/projects/{projectId}/brand-assets/generations/{generationId}/approve` requires designated user and audit record.
- `POST /api/v1/projects/{projectId}/releases/sandbox` includes only approved asset pack version.
- `POST /api/v1/projects/{projectId}/releases/production` must enforce a distinct human authorization, independent from design approval.

An implementation must scope each API call to the current project/operator, prevent uploads to unapproved destinations, and never allow the skill to assume a connector action succeeded without confirmation.

## V1 temporary capability

`game-studio/src/brandAssets.js` currently generates an original typography-based visual pack in the browser. Studio V1 supports metadata editing, asset preview and ZIP export for manual installation. It does **not** yet have AI illustration generation, server-side asset storage, API invocation by a ChatGPT Skill, per-asset review history, publication automation, or a verified live Telegram preview. These are future delivery gates.
