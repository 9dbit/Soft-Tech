# V5 Asset Handoff

Original reference files were supplied in the ChatGPT conversation.
- Reference master: `soft_tech_pixel_game_studio_hero.png` (1586x992)
- Computer photography: `IMG_3543.jpeg` (1024x1536)
- Soft Tech logo: `IMG_3020(1).PNG` (original, already in repo under `public/assets/soft-tech-logo.png`)

The local artifact bundle contains:
- `assets/orange-computer-cutout.webp`: extracted RGBA foreground asset, 1024 x 1536
- `preview/v5-composition-preview-1586x992.png`: static composition review
- `reference/soft_tech_pixel_game_studio_hero.png`: exact approved master reference
- `prototype/index.html` + `prototype/v5-static-desktop.css`: standalone HTML prototype
- `scripts/extract_assets.py` and `scripts/render_v5_preview.py`: offline reconstruction/preview scripts

The homepage React component expects:
`public/assets/v5/orange-computer-cutout.webp`

This must be copied into the repository branch before release. Work in a branch, not production.
