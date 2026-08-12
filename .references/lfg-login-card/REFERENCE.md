# Reference clone-spec — Member Login - LFG Dubai

Source: https://www.lfgdubai.com/login  
Captured: 2026-07-29T08:05:37.629Z

> Structural replica reference. Replicate layout, type scale, spacing, and motion.
> Do NOT reuse the source's copy, images, or code. Drop in the client's own brand + assets.

## Fonts
- Primary families: Barlow Condensed, Barlow

## Type scale (largest → smallest)
| tag | size | line-height | weight | tracking | transform | family |
|--|--|--|--|--|--|--|
| h1 | 38px | 36.1px | 900 | -0.38px | uppercase | Barlow Condensed |
| a | 15px | normal | 700 | 1.8px | uppercase | Barlow Condensed |
| button | 15px | normal | 700 | 1.8px | uppercase | Barlow Condensed |
| p | 14px | 21px | 400 | normal | none | Barlow |
| p | 13px | 20.8px | 400 | normal | none | Barlow |
| button | 12px | normal | 400 | normal | none | Barlow |
| a | 12px | normal | 400 | 1.44px | uppercase | Barlow Condensed |

## Colors
- Text: #ffffff #000000 #1a1a1a #999966 #0a0a0a
- Background: #999966 #ffffff #0c0c0c #0a0a0a #111111

## Layout
- Container widths: —
- Sections (1), top→bottom:
| # | tag | height | pad-top | pad-bottom | display | bg | headings | media |
|--|--|--|--|--|--|--|--|--|
| 1 | div | 900px | 32px | 32px | flex | — | 1 | yes |

## Radii / shadows
- Radii: —
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
  "transitionsCount": 7,
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