# SOFT TECH / V5.6 mobile rebuild checkpoint
Date: 2026-10-30

## Goal
Correct iPhone header logo, thin gray editorial heading, and artifact-free independent parallax assets.

## Code
- Branch: feat/v5-desktop-pixel-match-20261030
- React: src/components/v52-mobile-hero.tsx
- CSS: src/app/v52-mobile.css
- Asset export: scripts/export-v56-png-assets.py
- Asset CI: .github/workflows/v56-assets.yml
- Final source commit: b6f114b8cbb31ec3c8676d0b57bb8a0cab3bc9c8
- Auto-export asset commit: 9c5e2c73f4953f1a7535949cac64d5ed235e1717

## Assets
- public/assets/v5/soft-tech-header-cropped.png (original neon brand, alpha-trimmed)
- public/assets/v5/png/monitor-layer.png
- public/assets/v5/png/keyboard-layer.png
- public/assets/v5/png/printer-layer.png
- public/assets/v5/png/cable-layer.png
- public/assets/v5/png/cartridge-layer.png
- public/assets/v5/png/cursor-layer.png

The six PNGs are independently alpha-masked source parts converted from original repo assets; no opaque sheet, no image-generation checkerboard. The full-computer WEBP remains only as a load fallback, and disappears when all six PNGs have loaded. Depth transforms use moderate staggered translation without duplicate whole-object overlays, radial feathering, or blur.

## Visual
- Original neon Soft Tech logo left-aligned and sized to menu controls.
- Transparent fixed header; separate liquid glass pill buttons for language and menu.
- Thin gray Manrope editorial heading.
- Neutral solid gray background and solid cards.
- No extra moving sparkle animations.

## Deployment
Railway preview service: soft-tech-v5-preview
URL: https://soft-tech-v5-preview-production.up.railway.app/
Production main remains unchanged.

## Validation
GitHub Actions: V5 Desktop Prototype QA, screenshot and mobile controls, iPhone 360-430 and tablet 768-1024.
Railway deployment: verify latest commit b6f114b8cbb31ec3c8676d0b57bb8a0cab3bc9c8 reaches SUCCESS before reporting final.
Known caveat: 3D layers are transparent raster parts, not 3D geometry; more dramatic separation would require source model / physically accurate occlusion masks.
