# Soft Tech - Orange Computer Deep Parallax Production Rollback

Date: 2026-11-02 (Asia/Jakarta)

## User instruction
User explicitly requested rollback of broken Soft Tech UI to the orange-computer parallax version.

## Target version
- Source repository: https://github.com/9dbit/Soft-Tech
- Source branch: feat/v5-desktop-pixel-match-20261030
- Pinned commit: 48a9da2f714cdd9a6dd11efbc2e8078a114a258e
- QA baseline: GitHub Actions run 40995269575, status SUCCESS. See https://github.com/9dbit/Soft-Tech/actions/runs/40995269575
- UI: original orange computer artwork, six independently layered 3D parallax elements, original neon Soft Tech logo, editorial desktop design and responsive mobile fallback.

## Production restore operation
- Railway project: 0e6f5bdf-8437-41e1-a709-b42476cd143e (Soft-Tech)
- Railway environment: production (9d39a708-0653-4d6c-9f88-d1e730833492)
- Railway service: soft-tech-web (c45d7a8d-7f4d-4167-9fb5-8fd9d8bce2b1)
- Production URL: https://soft-tech-web-production.up.railway.app/
- Operation: connect-service-source to repo 9dbit/Soft-Tech, branch feat/v5-desktop-pixel-match-20261030, pinned commit SHA above.
- Deployment: d3f0d2ff-5bd7-4456-8d9a-0273dae079d1 -> SUCCESS.
- Health: Railway service online, one running / zero crashed replicas, zero warnings/critical alerts.
- Source read-back confirms commit SHA pinned, not following the moving branch. Future pushes to main/V5 should not auto-update production until source is explicitly reconnected.

## Limitations
- Independent HTTP/browser probe from this tool environment was blocked by external DNS, not by a confirmed Railway error.
- Visual pixel equality in the user's live browser is not yet reverified. User can open the live production URL and perform a hard refresh.
- Production is at the pinned V5.1 version. Main remains the later V4 / QA branch history; this was a deployment source rollback, not a git-history rewrite.

## Subsequent change rules
Do not repoint production to main or to floating V5 branch without explicit user instruction. Any upcoming visual changes must be tested on the dedicated preview service or an isolated branch first. Preserve the orange computer artwork and real six-layer parallax as the baseline.
