# V5 Asset Handoff — current release

**Master image:** `soft_tech_pixel_game_studio_hero.png`, user-approved, 1586 × 992.  
**Source photo:** `IMG_3543.jpeg` (orange computer, 1024 × 1536).  
**Soft Tech logo:** original attached, source preserved in `public/assets/soft-tech-logo.png`.

## Assets already in the V5 branch
- `public/assets/v5/orange-computer-cutout.webp` (original RGBA full image)
- `public/assets/v5/soft-tech-neon-header.webp` (cropped original logo)
- `public/assets/v5/monitor-layer.webp`
- `public/assets/v5/keyboard-layer.webp` (duplicate cartridge fragment removed)
- `public/assets/v5/printer-layer.webp`
- `public/assets/v5/cable-layer.webp` (continuous lower coil repaired from original source)
- `public/assets/v5/cartridge-layer.webp`
- `public/assets/v5/cursor-layer.webp`

All files are committed and deployed to the isolated `soft-tech-v5-preview` Railway service. No manual asset copying remains necessary.

## Browser QA assets
Run: https://github.com/9dbit/Soft-Tech/actions/runs/40995269575
Download GitHub Actions artifact named `soft-tech-v5-desktop-visual-qa`. It contains real Chromium screenshots for 1586×992, 1440, 1366, 1920 and 390, and `report.json` showing zero violations.

The approved original master and experimental extraction scripts are retained in the conversation handoff ZIP, not copied into the public production site to avoid unnecessary bytes.

See `CHECKPOINT_2026-10-30_V5_1_PARALLAX.md` for remaining design review and merge criteria. This is still a **Draft PR**, not yet merged to `main`.
