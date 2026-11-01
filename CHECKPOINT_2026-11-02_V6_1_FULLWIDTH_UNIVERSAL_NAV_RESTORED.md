# SOFT TECH / V6.1 Full-Width Orange Computer + Universal Navbar Recovery
Date: 2026-11-02 (Asia/Jakarta)
Repository: https://github.com/9dbit/Soft-Tech

## User correction
The previous Oct 30 V5.1 rollback was too old. The user requested the later version with the orange computer deep parallax, edge-to-edge full-screen desktop hero, and exactly one universal navbar matching the home page on all routes.

## Recovered source
- Exact V6.1 UI commit: `7be8c6c29c1fd0d862b9394e84f2025f5d7a30bc`.
- Restoration branch: `fix/soft-tech-v6-1-universal-restore-20261102`.
- Production-pinned commit: `d72a61059e69437eda7308e3c7df6df0fe978b63`.
- The restoration commit changes ONLY browser QA and workflow triggers compared with V6.1 visual source. Visual UI, assets, 6-layer parallax and layout are unchanged.
- V6.1 CSS in `src/app/v58-landscape-games.css` sets desktop main stage `width:100%`, `margin:0`, `border-radius:0`; keeps 3 landscape game cards per row and uses `.site .top-header` across Home / Games / Studio / Technology / Partners / Contact and game detail routes.
- Mobile header style parity was introduced before V6.1 (V5.9).

## Regressions deliberately excluded
- Later `c3c50dc1...` introduced broad typography declarations for the whole site (V6.3).
- Later `44e80ebd...` applied `!important` pixel headline + line-height overrides (V6.4), disturbing headline/layout geometry. Those changes are excluded from restoration.

## Verification
- GitHub Actions run: https://github.com/9dbit/Soft-Tech/actions/runs/41348848854
- Next.js build and TypeScript: SUCCESS.
- Real Playwright cross-device visual QA: SUCCESS.
- Automated screenshots taken for 1586, 1440, 1366, 1920 desktop; 1024 / 768 tablet; 430 / 393 / 390 / 375 / 360 mobile; plus all 5 interior routes. Screenshot artifacts: `soft-tech-v5-2-cross-device-qa`.
- The new recovery `master-1586x992.png` screenshot SHA256 exactly matches the original V6.1 screenshot from GitHub run 41336690812: `0b6690c4518193a2582a7bad0a398984988dcd26df273a23eee8ab28bf2b719e`.

## Railway production
- Project `0e6f5bdf-8437-41e1-a709-b42476cd143e`, environment `9d39a708-0653-4d6c-9f88-d1e730833492`.
- Production service `soft-tech-web`: `c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1`.
- Production URL: https://soft-tech-web-production.up.railway.app/
- Deployment `62a7879d-175c-416a-876d-e2ad37c08e79` -> SUCCESS.
- Read-back confirms GitHub source is PINNED to `d72a61059e69437eda7308e3c7df6df0fe978b63`, rather than tracking a moving branch.
- Service Online, 1/1 replica, 0 crashes, 0 warning or critical notifications.
- Runtime `next start` log shows Ready in 111ms.

## Preview
- Dedicated preview service `soft-tech-v5-preview` was restored to `3292c1c67b562f7b8e63bde2d8803760c5ffcb4c`, visually identical V6.1 source, deployment `0ddb8d61-1718-47c8-bea4-3f8133efe239` SUCCESS.
- Preview domain: https://soft-tech-v5-preview-production.up.railway.app/.

## Safeguards
Do NOT merge the later V6.3/V6.4 CSS overrides or repoint production to `main` / moving `feat/v5...` branch. Do not change the orange-computer assets, depth animation, shared header, or full-bleed geometry without explicit user approval. Future changes should branch from this V6.1 restoration commit, pass screenshots + browser QA, then be deployed via a new pinned SHA.
