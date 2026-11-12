# Universal Game Studio V2: visual benchmarks from three existing games

Status: ENGINEERING AND ART-DIRECTION REQUIREMENTS, NOT DEPLOYED FEATURES.
Scope: separate Game Factory / Universal Studio branch. Do not modify existing Skygate, Mahjong Wild or UNO Luck production repos.

## Skygate (https://github.com/9dbit/Skygate)
- Source anchors: `studio/project.json`, `studio/themes/olympus-gold/project.json`, `studio/ASSET_CATALOG.md`, `studio/README_STUDIO.md`, `studio/index.html`.
- 1080x1920 portrait source, ~23 independent scene layers: storm/sky, marble columns, guardian, sculpted logo, banners, 6x5 game-board window, ornamental frame, live bet/credits/win, bonus/control deck, center Spin, Auto/Turbo, sound, menu and info.
- Reusable: depth-sorted composition, grouped reusable assets, crop transforms, separate hit targets, event-bound sounds, phone viewport/live renderer.
- Caveat: original flattened art was separated into editable cutouts; derived cutouts can retain halos. Do not present this process as recovered PSD or native 3D.

## Mahjong Wild (https://github.com/9dbit/Mahjong-legend)
- Sources: `ASSET_PIPELINE.md`, `BRAND_AND_UI_NOTES.md`, `docs/RELEASE_V091.md`, `web/assets/control-panel-v091/provenance.json`, `studio_ui/README.md`.
- Approved 9:16 red-lacquer / jade / gold / bronze design with dragons, lanterns and clouds. Dedicated 17-symbol tile master family with normal/gold state, pure symbol faces, masks, VFX and audio.
- Asset provenance records immutable approved reference SHA, clean stage-background derivation, exact atlas crop windows and separate live DOM counters.
- Reusable: approved-master lock, material consistency, original and derived hash registry, sprite atlas extraction, 218x327 tile transforms, separate panel and live text, mobile safe-area/hitbox testing.
- Caveat: visual regression occurred when an approved red/gold control stage was replaced by a flat jade footer. Do not silently modernize locked artwork.

## UNO Luck (https://github.com/9dbit/uno-luck)
- Sources: `app/static/orbit-index.html`, `app/static/art/README.md`, `app/static/art/v11.css`, `docs/UNO_LUCK_v11.md`.
- Distinct genre-specific UI: red/black lava temple, 3D-styled dragon wheel, nine LED sockets, live card fronts, three result-card outputs, center Spin, Turbo/Auto, dynamic BET/PAYOUT/WIN and five-tier celebration artwork.
- Reusable: independent asset/hitbox controls, source art as backdrop rather than fake rig, viewport-scoped celebration, semantic live cards, result-gated animation, reduced-motion correctness.
- Caveat: a flattened wheel reference is not an actual rig, and no visual preview may claim a server result.

## Shared visual quality standard
1. Never use one universal rectangular CSS reel template for different genres. Match the mechanic with an original scene composition.
2. Original high-resolution key visual -> approval -> separated PNG/WebP alpha asset families -> scene graph -> interactive compositor -> mobile/desktop visual QA.
3. Scene IDs for background, hero/ornament, title, frame, game symbols/cards, controls, HUD, effects and ranked celebrations. Preserve semantic DOM text for dynamic data.
4. Record source reference, prompt/revision, master hash, image export hash, dimensions, alpha, crop, z-index, state and event binding. Never overwrite an approved master.
5. Image generation makes pixels, not PSD layers or a legitimate 3D rig. Retained background, alpha halos, inconsistent lighting and baked numbers must be rejected.
6. Generate Apple touch, favicon, PWA and Telegram/OG from approved art language; initials are wireframe-only.
7. Preserve independent test gates: art signoff does not approve math, RNG, real wallet, security or production.

The reusable Skill is packaged separately as `softtech-game-factory`. Its references `visual-benchmarks.md`, `image-asset-production.md`, and `asset-pack-contract.md` specify the art-generation workflow in more detail.
