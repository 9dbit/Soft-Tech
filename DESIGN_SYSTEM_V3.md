# SOFT TECH V3 — UI DESIGN SYSTEM

## Visual direction

Contemporary editorial technology studio: **5% light grey and pristine white**, deep charcoal typography, iridescent pink/magenta/blue neon accent lighting. Keep the brand's original pixel-tech logo intact, including its original color gradient. No navy gradient background.

## Palette
- **Canvas:** `#F2F2F3` (5% black in RGB)
- **Primary surface:** `#FFFFFF`
- **Off-white:** `#FAFAFA`
- **Text:** `#17141E`
- **Secondary text:** `#777480`
- **Blue:** `#6E82FF`
- **Cyan:** `#46C5FF`
- **Magenta:** `#C940E3`
- **Pink:** `#FA4FB5`
- **Border:** `#E5E2E9`

## Type scale
**Display:** Outfit 800, tight tracking `-0.07em` to `-0.09em`.  
**Body:** Plus Jakarta Sans 400–700.  
**Hero:** 72–126px desktop, 53–88px mobile/tablet depending on width.  
**Section titles:** 44–78px desktop.  
**UI labels:** 9–12px, spaced uppercase where appropriate.

## Components
- Floating translucent white header with compact original-logo plate and horizontal links.
- Editorial split hero; left display copy and active-game quicklinks, right interactive poster stack.
- Three 3D posters with center focus, mild skew for neighboring games, bright neon strokes.
- Light cards with original game cover art, subtle tilt, highlight follower and pink shadow.
- Buttons: deep charcoal primary, white secondary, spectral accent focus and hover.
- Off-white studio identity panel with pale branded orbit lights and original logo.
- White footer with pastel neon ambient gradient. Avoid navy areas.

## Animation and performance
- `requestAnimationFrame` limits pointer-driven DOM writes.
- One-shot `IntersectionObserver` reveal transitions.
- Limit transforms to perspective, scale, translate, rotation and opacity.
- Pause carousel on mouse hover; disable auto-motion when `prefers-reduced-motion` is active.
- Avoid side-to-side page overflow at mobile breakpoints.
- Native keyboard navigation for carousel, escape to close mobile drawer.

## Breakpoints
- `<=1470px`: compact navigation and poster scale.
- `<=1140px`: narrower hero and cards.
- `<=1040px`: mobile-drawer navigation takes over.
- `<=930px`: hero stacks vertically.
- `<=730px`: smaller interactive poster stack, horizontal quicklink scrolling and featured collection card.
- `<=420px`: narrow-phone typography and spacing optimization.

## Design QA
In a visual browser, check desktop and mobile before making additional design changes. Keep each screenshot linked to a viewport, URL and revision. Track any clipping/overlap corrections in a checkpoint MD.
