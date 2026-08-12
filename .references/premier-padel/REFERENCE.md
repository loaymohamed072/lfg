# Reference clone-spec — Page Not Found

Source: https://premierpadel.com/en/rankings  
Captured: 2026-08-12T18:34:01.881Z

> Transfer reference. Every block below is a menu of concrete moves to CARRY, ADAPT, or REJECT
> (with a reason) in the build's Reference Transfer block — not background reading.
> Do NOT reuse the source's copy, images, or code. Drop in the client's own brand + assets.

## Fonts
- Primary families: Blender Pro
- @font-face: Blender Pro, Designer, Blender Pro Regular, Blender Pro ExtraBold, Blender Pro Italic, Blender Pro BoldItalic, Blender Pro Bold, Blender Pro Medium, Blender Pro MediumItalic, Blender Pro Thin
- Google/Bunny: https://fonts.googleapis.com, https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap

## Type scale (largest → smallest)
| tag | size | line-height | weight | tracking | transform | family |
|--|--|--|--|--|--|--|
| h1 | 74px | 74px | 900 | 1.85px | uppercase | Blender Pro |
| h4 | 30px | 32px | 900 | normal | uppercase | Blender Pro |
| h2 | 24px | 21.6px | 800 | -0.6px | uppercase | Blender Pro |
| span | 24px | 21.6px | 800 | -0.6px | uppercase | Blender Pro |
| p | 20px | 18px | 500 | normal | none | Blender Pro |
| a | 20px | 28px | 900 | normal | uppercase | Blender Pro |
| a | 18px | 28px | 600 | normal | uppercase | Blender Pro |
| button | 18px | 28px | 600 | normal | uppercase | Blender Pro |
| a | 16px | 24px | 400 | normal | none | Blender Pro |
| p | 12px | 16px | 400 | normal | capitalize | Blender Pro |
| span | 12px | 16px | 400 | normal | uppercase | Blender Pro |

## Colors
- Text: #000000 #ffffff
- Background: #ffffff

## Layout
- Container widths: 1440px
- Sections (4), top→bottom:
| # | tag | height | pad-top | pad-bottom | display | bg | ground | layers | headings | media |
|--|--|--|--|--|--|--|--|--|--|--|
| 1 | div | 868px | 0px | 0px | block | — | — | 0 | 0 | no |
| 2 | div | 133px | 0px | 0px | block | — | — | 0 | 1 | yes |
| 3 | section | 758px | 0px | 0px | flex | — | — | 0 | 1 | yes |
| 4 | footer | 477px | 0px | 0px | block | #ffffff | flat | 0 | 0 | yes |

## Atmosphere / ground construction
> This is the layer that makes the reference feel expensive. If the build's Reference
> Transfer block rejects everything here, the reason had better be good.
- Gradients: 
  - `linear-gradient(in oklab, rgb(0, 0, 0) 0%, rgb(26, 26, 26) 50%, rgb(0, 0, 0) 100%)`
- Blend modes: —
- Filters: —
- Backdrop filters: —
- Masks: —
- Decorated pseudo-elements: 
  - `section::before: bg=url("https://premierpadel.com/_next/static/media/header-border-img.3hstanitu_4uf.svg") blend=normal opacity=1`
- SVG turbulence (noise/grain) nodes: 0
- Large WebGL canvases: 0  ·  Video backgrounds: 0

## Radii / shadows
- Radii: 12px, 14px
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
  "transitionsCount": 42,
  "observed": {
    "animationsAtRest": 0,
    "elementsChangedOnScroll": 0,
    "smoothedScroll": false
  }
}
```

## Captured files
- screenshot-desktop.png
- screenshot-tablet.png
- screenshot-mobile.png
- scroll-through.webm