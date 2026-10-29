# SOFT TECH V4 — NEO-DIGITAL PLAYGROUND
Design system and animation specification

## Creative direction
A contemporary interactive game-studio website, combining:
- 45% Swiss/industrial editorial minimalism
- 35% retro-digital and playful 3D
- 20% cinematic neon futurism

Use a **5% light-grey background**, high-contrast charcoal typography, authentic artwork and a controlled pink-magenta-blue neon spectrum. No navy-gradient background. The design should feel like an independent digital studio, not a dashboard or casino wallet.

## Brand source
Original SOFT TECH neon pixel logo:
`public/assets/soft-tech-logo.png`
Do not distort, redraw, recolor or stretch it.

## Color tokens
| Token | Value |
| --- | --- |
| Canvas | `#F2F2F3` |
| White | `#FFFFFF` |
| Charcoal | `#151216` |
| Muted | `#716C75` |
| Pink | `#FF3DB8` |
| Magenta | `#CB35D9` |
| Blue | `#548DFF` |
| Cyan | `#51D5FF` |
| Main spectrum | `linear-gradient(103deg,#49caff 0%,#7c81ff 33%,#da35dc 67%,#ff559a 100%)` |

Use neon for highlights, layering and interaction rather than full-page decorative gradient fills.

## Typography
- **Barlow Condensed 800/900**: giant editorial hero and section titles.
- **Manrope**: readable body, menus and CTA labels.
- **DM Mono**: microtype labels, coordinates, captions, technical information.
- **Pixelify Sans**: restrained pixel micro accents, indices and game identity markers.

Hero typography is an active spatial layer. Artwork overlaps the headline.

## Homepage sequence
1. Fullscreen **BEYOND PLAY.** interactive editorial hero, 3D poster and floating layer assets.
2. Kinetic brand ticker.
3. Staggered 3-card showcase with luminous 3D tilt and playable demo CTAs.
4. Sticky scroll storytelling panel with the three flagship worlds.
5. Studio narrative, logo sculpture, capabilities and corporate CTA.

## Hero interactions
- Active games: Skygate 5000, UNO LUCK, Mahjong Wild.
- Poster transitions, themed lighting and isolated original foreground assets.
- `requestAnimationFrame` on pointer movement, CSS pixel-valued custom properties for Safari compatibility.
- Magnetic play CTA with translation bounded to a small percentage of pointer position.
- Carousel automatically advances approximately every 9 seconds unless pointer-hovered or prefers-reduced-motion is on.
- Left/right buttons, direct progress selectors, keyboard ArrowLeft/ArrowRight.
- On touchscreens, horizontal swipes advance the carousel only when horizontal travel exceeds 58 px and dominates vertical movement; normal vertical scroll is preserved.
- Giant background lettering uses a single entrance mask reveal, with opacity preserved on mobile.

## Game artwork provenance
- `public/assets/skygate-cover.jpeg`: Skygate 5000
- `public/assets/uno-luck-cover.webp`: UNO LUCK
- `public/assets/uno-luck-detail.webp`: separated transparent dragon wheel
- `public/assets/mahjong-cover.jpg`: Mahjong Wild
- `public/assets/mahjong-dragon.webp`: original transparent dragon ornament from Mahjong repository
- `public/assets/mahjong-wild-tile.webp`: original gold WILD Mahjong tile
- `public/assets/mahjong-logo.webp`: original Mahjong logo asset

All original game engines remain untouched. No licensed third-party game reference artwork was copied.

## Responsive principles
- Desktop: oversized type and centered overlapping artwork.
- <=1180px: narrower perspective layers and compact rail typography.
- <=940px: vertically stacked storytelling and single hero focal zone.
- <=730px: poster-first experience, controls and readable copy beneath, card-story scrollytelling.
- <=440px and <=370px: narrow-phone optimizations, rounded touch targets, no overflow.
- Touch uses native vertical scrolling. Mouse-only parallax does not run on touch devices.
- `prefers-reduced-motion`: disables timeline autoplay and nonessential entrance, hover and pointer effects.

## Source files
- `src/components/v4-playground.tsx`
- `src/app/v4.css`
- `src/app/v4-responsive.css`
- `src/components/portal.tsx` (mounts V4 hero and story)
- `src/app/layout.tsx` (imports V4 styles after V3)

## Quality gates
1. Next.js production build and TypeScript checks pass.
2. Railway release is SUCCESS; `/api/health` responds.
3. All 3 game links open official live demos.
4. Check desktop 1440, 1280, tablet 1024/768, iPhone 393, Android 360.
5. Ensure no clipped CTA, horizontal page overflow or text/art collision at each breakpoint.
6. Verify keyboard carousel, touch swipe, hover pause, and reduced-motion preferences.
7. Check glow intensity and the original pixel logo against light and dark surfaces.

## Known scope
This is a studio showcase and external game demo launcher, not a financial service or gaming operator. No deposits, withdrawals, cash betting or fabricated studio KPI data. Contact messages remain copy-to-clipboard until an official verified mailbox is connected.
