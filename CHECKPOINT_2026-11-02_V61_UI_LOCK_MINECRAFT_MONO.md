# Soft Tech V6.1 UI Lock and Typography

Source/UI baseline: `d72a61059e69437eda7308e3c7df6df0fe978b63` (validated GitHub workflow 41348848854).

The orange computer, six motion layers, full-bleed hero, universal desktop navbar and mobile responsive layout are locked using `scripts/verify-ui-lock.mjs`. It verifies original Git blob IDs in CI; the font extension cannot silently edit them.

## Typography-only extension
- Source: user-provided `Minecraft.ttf`, checked as Minecraft Medium (107 glyphs), converted to WOFF2 to reduce transfer size from 14,488 bytes to 3,180 bytes without changing outlines.
- Bundled font: `public/fonts/Minecraft.woff2`, `@font-face` alias `SoftTech Minecraft`.
- Applied only to editorial section headings (page titles, collection, studio, corporate sections, footer section headings). Main computer hero and game cover logotypes remain unchanged.
- Editorial paragraphs, list text and form text use the OS monospace stack. Navbar controls and buttons are not modified.
- Typography-only file `src/app/v61-locked-typography.css` is imported after all existing CSS.
- Responsive font size caps prevent long pixel headings from overflowing while preserving original section/container positions.

## Validation
The V5/V6 Playwright suite now also tests actual Minecraft font loading, computed heading fonts, monospace paragraphs, full-width hero geometry and horizontal overflow across home, games, studio, technology, partners, contact and game detail routes at desktop and mobile widths. Screenshots are uploaded to the GitHub Actions artifact.

This is a font extension; **never merge the broad V6.3/V6.4 global font override commits**. To modify the locked UI, explicitly update the guard manifest only after visual review.

## Deployment gate
A release is allowed only after GitHub Actions build, UI-hash guard and real-browser typography/geometry tests pass. Railway production will remain pinned to the last approved commit; visual changes first go to the independent preview service.

## Hero headline
The desktop `BUILDING / DIGITAL / GAME WORLDS / THAT STICK` and equivalent mobile homepage hero text are also editorial headings and use Minecraft. Their existing line structure and absolute/flow positions remain unchanged. Font size is capped independently at each breakpoint to avoid overlapping the orange-computer parallax artwork. Screenshots are now captured with reduced motion enabled so IntersectionObserver-revealed sections are visible in full-page evidence.
