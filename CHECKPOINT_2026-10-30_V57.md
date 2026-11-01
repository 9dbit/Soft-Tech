# SOFT TECH CHECKPOINT V5.7 — 2026-10-30

## Scope
Applied the user-requested styling corrections across the five inner pages and shared navigation:
- /games
- /company (Studio)
- /technology
- /partners
- /contact
- shared footer, sidebar and header

## Source
Branch: feat/v5-desktop-pixel-match-20261030
UI implementation: eec8499cf460cdd9776ec9a907094bf8f07057c3
Cross-route QA implementation: dd1d413ce8ab4b22977163f257e263ccc859608b
New stylesheet: src/app/v57-unified-ui.css (imported last from src/app/layout.tsx)
Logo replacement: src/components/portal.tsx

## Fixes
1. Removed all CSS text-gradient rectangles from editorial headings and em elements by overriding the background shorthand and background-clip mismatch.
2. Switched large display headings to rounded Nunito Sans, medium grey (#68666e), including games, company, technology, partners, contact, and footer.
3. Switched action buttons to solid purple (#a638d4) and full pill radius.
4. Removed black plaque behind header and sidebar logos; sidebar now loads alpha-trimmed original Soft Tech logo /assets/v5/soft-tech-header-cropped.png.
5. Removed dark sidebar promo background, replaced with light lavender and readable grey text.
6. Kept game artwork unchanged, and retained light grey editorial surfaces.

## Verification
GitHub Actions V5 Desktop Prototype QA: run 41063301096, SUCCESS.
- Next.js build and TypeScript: SUCCESS.
- Browser QA: SUCCESS.
- 11 home viewport screenshots including iPhone, tablet and desktop.
- New route-wide screenshots: five pages x iPhone 393 and desktop 1440.
- Automated checks for gradient rectangles, dark logo and promo plaques, purple footer CTA, horizontal overflow.

Railway preview service: soft-tech-v5-preview
Preview URL: https://soft-tech-v5-preview-production.up.railway.app/
Last app-code commit dd1d413ce8ab4b22977163f257e263ccc859608b reached SUCCESS.
Production main has not been changed.

## Next
Request visual signoff on preview before merging into main. Review game detail artwork contrast separately, because black in original game images is intentional content, not a UI surface.
