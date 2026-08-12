# Reference clone-spec — Performance Running Gear, Apparel, and Accessories | Tracksmith

Source: https://www.tracksmith.com/  
Captured: 2026-08-05T09:54:14.647Z

> Transfer reference. Every block below is a menu of concrete moves to CARRY, ADAPT, or REJECT
> (with a reason) in the build's Reference Transfer block — not background reading.
> Do NOT reuse the source's copy, images, or code. Drop in the client's own brand + assets.

## Fonts
- Primary families: akzidenz-grotesk-extended, SainteColombe
- @font-face: Didot, Kanit-Klaviyo-Hosted, Saint Colombe, Sainte Colombe Tracksmith

## Type scale (largest → smallest)
| tag | size | line-height | weight | tracking | transform | family |
|--|--|--|--|--|--|--|
| li | 16px | 24px | 400 | normal | none | akzidenz-grotesk-extended |
| p | 13px | 20.02px | 400 | normal | none | SainteColombe |
| a | 13px | 20.02px | 400 | normal | none | SainteColombe |
| span | 13px | 20.02px | 400 | normal | none | SainteColombe |
| a | 12px | 24px | 400 | 1.2px | uppercase | akzidenz-grotesk-extended |
| button | 10px | 16px | 500 | 1px | uppercase | akzidenz-grotesk-extended |
| span | 10px | 16px | 500 | 1px | uppercase | akzidenz-grotesk-extended |

## Colors
- Text: #0a1e32 #ffffff #6c7884 #857151 #000000 #606a72 #6e7680 #9a825c
- Background: #ffffff #857151 #0a1e32 #cbd5e1 #000000 #141414 #9a825c

## Layout
- Container widths: 1800px
- Sections (3), top→bottom:
| # | tag | height | pad-top | pad-bottom | display | bg | ground | layers | headings | media |
|--|--|--|--|--|--|--|--|--|--|--|
| 1 | div | 4283px | 0px | 0px | block | — | — | 0 | 11 | yes |
| 2 | footer | 984px | 0px | 0px | block | #0a1e32 | flat | 0 | 0 | no |
| 3 | iframe | 150px | 0px | 0px | block | — | — | 0 | 0 | no |

## Atmosphere / ground construction
> This is the layer that makes the reference feel expensive. If the build's Reference
> Transfer block rejects everything here, the reason had better be good.
- Gradients: —
- Blend modes: —
- Filters: —
- Backdrop filters: —
- Masks: —
- Decorated pseudo-elements: 
  - `a::after: bg=none blend=normal opacity=0.2`
  - `div::after: bg=none blend=normal opacity=0.3`
- SVG turbulence (noise/grain) nodes: 0
- Large WebGL canvases: 0  ·  Video backgrounds: 0

## Radii / shadows
- Radii: 2px, 3px
- Shadows: —

## Motion engine
> Library flags (gsap/lenis/three/...) can be FALSE NEGATIVES on bundled Next/Vite sites.
> `observed` is the ground truth: animations running at rest, elements whose transform/opacity
> changed during a scripted 2-viewport scroll, and whether programmatic scroll is smoothed.
```json
{
  "gsap": false,
  "scrollTrigger": false,
  "lenis": false,
  "locomotive": false,
  "framerMotion": false,
  "three": false,
  "smoothScroll": false,
  "transitionsCount": 173,
  "observed": {
    "animationsAtRest": 2,
    "elementsChangedOnScroll": 0,
    "smoothedScroll": false
  }
}
```

## Captured files
- screenshot-desktop.png
- screenshot-tablet.png
- screenshot-mobile.png