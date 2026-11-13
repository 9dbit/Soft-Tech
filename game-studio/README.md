# Soft Tech Universal Game Studio V1

Independent **Figma-style** game editor proof-of-concept. All new source code lives under `game-studio/` on the feature branch. This does **not** replace Skygate, Mahjong Wild or UNO Luck studios.

## Run

```bash
cd game-studio
npm install
npm run dev
npm run build
```

## Workspaces

- **Visual Editor**: stage canvas and layer selection, drag-to-move, desktop/mobile coordinates, object inspector, PNG/WebP/SVG imports, dot / square / clean grids, background color presets and picker, grid opacity and spacing, zoom, local draft auto-save, Undo/Redo, JSON export.
- **Audio Studio**: optional user-supplied local sample audio, track volume and mute, playback. Audio file contents are not persisted in local storage.
- **Economy Lab**: separate, exportable **draft-only** bet, reels, paylines, target RTP. No certified math or actual RNG is implemented. Target RTP is never presented as measured or achieved.
- **Brand & Share**: generate PNG & ICO favicons, SVG favicon, Apple 180, Android 192/512, 512 maskable icon, 1200x630 Open Graph PNG for Telegram and social platforms, HTML metadata, and PWA manifest. Review interactive preview, download a ZIP of independent assets.

## Boundaries / known limitations

- V1 is a browser-local prototype. It uses localStorage rather than server persistence, roles or collaborative editing; drafts are device-specific and can be cleared by the browser.
- Canvas background/grid color is **editor chrome**, not exported game art.
- Visual **Preview** demonstrates UI scene changes only, without actual paylines, wallet, RNG, transactions or spin-state logic.
- Audio Studio provides sample file playback; timeline keyframes and final audio routing are not implemented.
- Image imports are limited to 1 MB in a local draft. Server asset storage, collaborative version history and proper size constraints need later work.
- Production release/publishing is NOT implemented and CI builds do not deploy. Keep existing studios and Soft Tech production untouched.
- Brand asset files are downloadable. A real live game must manually place them in a public root and add `meta-tags.html` tags in document `head` before public web crawlers (including Telegram) can preview the image. `og:image` requires a public HTTPS URL and Telegram may cache a previous preview.
- URL and metadata inputs are untrusted draft values. Meta tag output is escaped and HTTPS URLs are checked. The export may use placeholders, clearly flagged in Studio, but must not be deployed before correction.
- The ZIP generated from this V1 is a starter visual pack (text-based emblem). Professional illustration generation and visual-asset approvals are future integrations.

## Status

CI: `.github/workflows/game-studio-ci.yml`, source smoke test and Vite build.
Plan: validate UI and asset export in an isolated staging environment, then implement persistent asset versioning and connectors. Create the **Game Factory Skill** only once the standalone Studio contract is stable. No direct production access or automatic publication.

## Safety constraints for future Game Factory Skill

A future Game Factory Skill may propose UI and generate the icon/metadata pack through the Studio's assets service. Its instructions must require a human creative review, a valid public URL, and preview/quality checks. Publishing to production, changing game mathematics, or integrating financial wallets must use independent, explicit approval gates.

### Legend Ball V12 visual draft

The linked Legend editor now opens the V12 media catalog and uses a separate
V12 local draft key. Loading an older live snapshot preserves its math, audio,
credit and bet settings while applying the new visual layers to the draft;
loading does not publish or mutate that live snapshot. An empty release is valid.

Moving or resizing the Total Bet frame also transforms its minus button,
amount and plus button. The individual controls start locked. Native export
preserves these coordinates and the existing engine settings. Sound and volume
remain in the game's Menu. The standalone gameplay sound button and provider
footer are hidden in the V12 project.

Validation: 49 unit tests passed and the embedded production build passed.
Browser/device QA is still pending: this workspace cannot launch Chromium,
and WebKit is not installed. No remote publication or deployment has occurred.
