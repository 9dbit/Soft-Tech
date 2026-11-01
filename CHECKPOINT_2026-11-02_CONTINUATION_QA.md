# SOFT TECH / Continuation QA Checkpoint
Date: 2026-11-02 (Asia/Jakarta)
Repository: https://github.com/9dbit/Soft-Tech

## Scope
Continuation from the Nov 2 V4 typography and layout recovery after Minecraft font and cross-page header regressions.

## Verified current production
- Railway project: 0e6f5bdf-8437-41e1-a709-b42476cd143e
- Environment: production 9d39a708-0653-4d6c-9f88-d1e730833492
- Service: soft-tech-web c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1
- Current deployed UI: 11dd6a3c95f589b16a218c7afbc7b6791f693fd0, deployment 4da61970-1cea-44fd-b5c6-b7766dd1bf93, SUCCESS.
- State: online 1/1 replica, 0 crashed, 0 current warnings or critical issues.
- 12-hour HTTP snapshot: 33 requests, 0 5xx, 1 client error.

## Main branch improvement
- Commit da82a565f793b921725878b321be6ab690b4b494 changes ONLY scripts/qa-production-layout.mjs.
- Added desktop 1440 and mobile 390 navigation/typography/geometry audit for /, /games, all three game details, /company, /technology, /partners and /contact.
- Checks shared header dimensions and color, menu order, responsive visibility, logo asset, main paragraph DM Mono, overflow, hamburger open/close, Escape, and runtime errors.
- GitHub workflow run https://github.com/9dbit/Soft-Tech/actions/runs/41347230566 finished SUCCESS.
- No production visual UI code was changed by this QA commit.

## V5 preview branch improvement
- Branch: feat/v5-desktop-pixel-match-20261030; draft PR https://github.com/9dbit/Soft-Tech/pull/1
- Preview service soft-tech-v5-preview c19f2aa0-8508-430f-a21c-0d3ac1be87bc, online, deployment 211458e6-375b-45f6-be95-4b1607a72ab7 SUCCESS.
- Prior browser QA run 41340583422 failed in scripts/v5-visual-qa.mjs:167 because it clicked hidden .v5-login after later V6 desktop header standardization. Master layout expectations also referenced old geometry.
- Commit d50e01270d0a7aef54533028638de65c140e2955 on V5 branch updates browser checks to use visible shared header and revised master geometry, with fallback legacy modal test if visible.
- This is QA-only, not a V5 UI design change. Recheck the new V5 workflow result before claiming QA PASS.

## Next requirements
- Preserve V4 UI baseline and font from the user-provided Minecraft.ttf.
- Keep Minecraft pixel typography scoped to editorial headings; DM Mono on content.
- Do NOT apply global h1-h6 font or line-height overrides again.
- User needs visual signoff before V5 PR merge. Never silently promote preview to production.
- Validate native iPhone Safari, desktop Chrome, and user-supplied visual reference before rollout.
