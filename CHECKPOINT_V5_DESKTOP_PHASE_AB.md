# Soft Tech V5 Desktop • Phase A/B Checkpoint
> **Superseded by [V5.1 deep parallax checkpoint](CHECKPOINT_2026-10-30_V5_1_PARALLAX.md).** The original Phase A/B file below is retained as a historical record only. The source WebP assets have now been uploaded, the deep parallax implementation is complete on the branch, and real-browser screenshot QA is available. Do not interpret its historical “pending source upload” statements as current status.


Date: 2026-10-30 (Asia/Jakarta)
Branch: `feat/v5-desktop-pixel-match-20261030`
Base: `main` (production remains on V4)

## Scope completed
- V5 desktop hero component is authored and mounted on homepage for desktop >=1100px.
- V4 retained for tablet/phone below 1100px, and all existing catalog/game/company/contact routes preserved.
- Master reference: `soft_tech_pixel_game_studio_hero.png` (1586 x 992 px) from user attachment.
- Desktop coordinates implement the same rounded grey frame, Soft Tech neon logo, centered navigation pill, right-side Login/Register visual with truthful partner notice, 4-line editorial title, 3 FLAGSHIP GAMES KPI, giant SOFT / TECH pixel words, CTA pair, social ornament and central scroll notch.
- No new parallax animation yet, per user-approved Phase A/B static-first sequence.
- Existing company logo remains sourced from `/assets/soft-tech-logo.png`.
- Gallery and three standalone game URLs remain untouched.

## Asset reconstruction
The source orange retro computer photograph `IMG_3543.jpeg` was processed offline:
- OpenCV GrabCut segmentation with manually defined object trimaps and alpha feathering.
- Transparent cutout file: `orange-computer-cutout.webp` (source output 1024 x 1536).
- Local integrated preview at 1586 x 992 generated for comparison.
- Some cream coiled-cable regions remain imperfectly segmented. These need final manual retouch before the source artwork can be called pixel-perfect.

**Historical note (superseded 2026-10-30):** `public/assets/v5/orange-computer-cutout.webp` is intentionally NOT yet included in the remote repository. GitHub's connected write action accepts textual/base64 content but cannot consume a local container path. The component currently has an honest CSS fallback computer shape for branch preview, while the actual cutout is in the downloadable Phase A/B asset bundle. Do not deploy or merge the branch as visually approved until the real cutout asset is installed and browser visual QA has passed.

## QA gates still required
1. Install original transparent foreground asset into `public/assets/v5/orange-computer-cutout.webp`.
2. Render the actual Next.js branch at 1586x992 in an interactive browser, compare 50% overlay with master screenshot; correct coordinates.
3. Verify desktop widths 1366,1440,1586,1920 and no clipping.
4. Verify all buttons are functional and the partner login notice is truthful.
5. After static screenshot sign-off, proceed to Phase C deep parallax on separated visual layers.
6. Deploy to staging first; do not overwrite production without user approval.

## Known limitation
Local screenshot prototype was generated using the original user-supplied foreground and deterministic positioning. Chromium headless screenshot from this runtime was unavailable, so pixel-perfect Next.js browser QA is not yet claimed.
