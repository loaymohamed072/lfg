# MUSANDAM-DESIGN.md — lfgdubai.com/musandam (LFG x Musandam: Fjords Day Escape)

Build 9 Oct 2026 (Ahmed's ask from 5 Oct; Loay 9 Oct: take the material from the operator's
page, build it). Register: EXPRESSIVE (declared). Visitor mode: Persuade, with one Experience
band (the fjord panorama). Sibling of PADEL-DESIGN.md; same house system (Barlow / Barlow
Condensed, ink ground, olive accent, grain 5%), its own composition.

## Message brief (copywriting lane)
- H1 candidates: "One day in the fjords." (composed around) · "Kayak. Swim. Climb. Ride." (the
  operator's own line, rejected: not ours) · "A Saturday in Musandam with the crew."
- Hierarchy: (1) one day, one dhow, Arabia's fjords → (2) what you actually do on the water
  (kayak, swim, deep water solo, banana boat, BBQ lunch) → (3) it is on a date with a price and
  twenty seats → (4) what is included and what to bring → (5) the LFG crew is going → (6) book.
- Primary CTA: "Book my seat". Price AED 320 (placeholder: USD 85 on the operator's page ≈ AED
  312; Ahmed sets the real number in the trips row, server-side like every LFG price). Capacity
  20 (placeholder, same row).
- Source material: the operator's page (climbyourownmountain.com/musandham-oman) for the facts
  (date, pick-up, itinerary anchors 06:00 / 08:00 / 08:00–16:00 on the water, inclusions, what
  to bring) and its 11 photos (Loay, 9 Oct: "we can take from the site it's okay"); every
  sentence rewritten in LFG's voice; nothing copied.

## Composition & Architecture (web-composition-architect)
- Site type: event/trip page inside the existing lfgdubai.com multi-page site. IA verdict: one
  page (campaign checklist 1/8; the site IA already exists).
- Section economy: 7 — Hero (the cliff cut) · The day (the fjord panorama, the signature) ·
  What you'll do (mosaic of four) · On the boat (included + bring, one plate) · Who's going ·
  Before you book (FAQ) · Close + book. Each does one job; the booking drawer is the eighth
  surface, not a section.
- Challengers: seed `lfg-musandam-2026-10-09` → A3, A6, unlisted "the tide table: the day told
  as a vertical hour rail with the photos keyed by hour". A3 lost (an editorial split wastes the
  only wide material we have); A6 lost (no video, and footage-plus-words is not a signature);
  the tide table lost to the panorama because the fjords are WIDE: the one thing these photos
  all share is a horizon, so the page's big move should move sideways.
- Hero archetype: BESPOKE "the cliff cut" — a full-bleed fjord photograph (their own) with an
  ink scrim rising from the foot, the H1 set in Barlow Condensed at clamp(60px→150px) over the
  lower third, and the booking plate (date, price, seats, CTA) overlapping the hero's bottom
  edge on the right. Beats L0: no media split; the photograph is the ground and the plate
  breaks its edge. Logged as new archetype candidate: "photo ground + plate over the seam".
- THE ONE BOLD MOVE: **the fjord panorama** — three of their landscape photographs stitched
  into one 300vw strip inside a sticky stage; scrolling the section pans the strip sideways
  under a fixed itinerary ruler (06:00 Dubai → 08:00 Khasab → on the water → 16:00 port →
  evening Dubai), so the day reads as a passage along the cliffs. Derivation: the operator's
  own photographs of the fjords and the operator's own schedule; nothing invented. Vanilla rAF
  on scroll (no lib), reduced motion → the middle photograph, still, with the ruler.
- Signature pair: (photo ground + plate over the seam, scroll-panned panorama with a pinned
  ruler). validate_build.py: VERDICT PASS (no L0, no pair/font/accent repeat).
- Motion weight class: LIGHT (static site, no bundler): vanilla JS scroll driver + CSS.
- Motion package: personality "the page moves the way the day does: sideways along the water,
  never up and down" · signature = the panorama · entrances: H1 line mask on load, IO reveals
  with 90ms stagger per section, mosaic tiles open with a clip-path inset reveal, plate rises
  with the hero · easing family `cubic-bezier(0.22, 1, 0.36, 1)` (house, from the padel page)
  · hovers: tiles scale 1.03 inside their frame, links underline-draw, CTA lift + press 0.98 ·
  reduced-motion branch: panorama static, reveals opacity-only, no lift.
- Spatial system: display clamp(60px, 11vw, 150px) lh 0.9 tracking -0.02em; H2 clamp(36px,
  5vw, 64px) lh 0.95; eyebrow 11px tracked 0.24em; body 17px lh 1.55 measure 62ch; heading gap
  law 2.5:1; eyebrow→H1 12px; H1→deck 28px; deck→CTA 32px; section padding 96/56; container
  1160px.
- Mobile (390): hero photo 100svh with the scrim higher; H1 clamp 60-68px over three lines; the
  plate stacks under the hero full-width (no overlap); the panorama stage is 100svh and the strip
  pans the same way; the mosaic becomes one big tile over two small tiles; the on-the-boat plate
  stacks its two ledgers; FAQ full-width; the drawer is the padel drawer at 92vw.
- Divergence dials: D1 photo ground + plate over the seam · D2 12-col mosaic with a right bleed
  · D3 Barlow Condensed monumental (brand-locked) · D4 scroll-panned strip under a pinned ruler
  · D5 ink + olive (brand-locked; no sea blue, the padel lesson) · D6 96px ramp · D7 photo
  grounds + graphite plates + hairlines + grain · D8 their real photography, graded.

## Atmosphere package (Step 7)
- Base ground: ink `#0A0A0A`, the brand's. Ground hue: deep (brand-locked).
- Ground sequence: hero PHOTO (scrim to ink) → ink → panorama PHOTO (full band) → ink → graphite
  plate (on the boat) → ink → ink + olive radial glow (close).
- Layered sections: hero (photo + scrim gradient + grain), panorama (photo strip + ruler), on
  the boat (graphite plate with an olive left rule), close (ink + olive glow + grain).
- Texture: the house SVG grain at 5% fixed over everything (from the padel page).
- Seams: hero → ink by the scrim gradient (carried); ink → panorama hard cut; panorama → ink hard
  cut; plate on ink with a hairline; close band by glow, no rule.
- Ambient: the panorama is scroll-linked; everything else static.

## Reference transfer (the contract)
- muchbetteradventures.com (captured 2026-10-09): CARRY the bottom-up ink scrim on photographic
  heroes (`linear-gradient(rgba(42,45,44,0) 0%, rgb(42,45,44) 100%)`) → the hero's scrim into
  ink; CARRY photographic grounds carrying the sell (their trip cards are the page) → the hero
  and the panorama are photographs, not plates; ADAPT their 4px radius → 4px on the plate and
  inputs only, tiles square; REJECT the lime/orange/blue progress gradients (brand-locked
  olive) and the underline.png accent.
- pelorusx.com (captured 2026-10-09; the site answered 522 mid-capture, the shot is partial):
  CARRY the light-weight large headline over a quiet ground as the rhythm for the FAQ/close
  type (weight 300 at 60px → our deck at 300); REJECT the grey gradient ground (ink is ours).
- The padel page (in-house sibling): CARRY the grain overlay, the kicker system, the drawer
  shell, the chips with the hairline left rule, the CTA fill `#B3B38A` with ink text; ADAPT the
  booking strip into the plate that overlaps the hero.
- Floor met: 7 carried/adapted across 3 references, 3 of them atmosphere moves (scrim, photo
  grounds, grain).

## Image Art Direction (editorial-image-treatment)
- Source: 11 photographs from the operator's page, used with Loay's say-so (9 Oct); WhatsApp
  quality, mixed 4:3 and 3:4, converted to webp at 1600 and 800 wide (`app-assets/musandam/`).
- Grade tier: 2 (saturation −12%, contrast +4%, blacks lifted) as one utility `.ms-img` so the
  mixed phone shots read as one set; the hero and panorama also carry the ink scrim; grain 5%.
- Default silhouette: square. The hero is full-bleed; the mosaic varies aspect (3/4, 4/3, 1/1)
  and one tile bleeds to the right viewport edge; nothing is rounded.
- Layout rhythm: one dominant image per view (hero, panorama, the big mosaic tile), supporting
  images smaller; off-centre focal points (object-position 60% 45% on the cliffs, 50% 30% on the
  climbers).
- Crop discipline: `<picture>` not needed (one crop per slot); `object-fit: cover` with a per-slot
  `object-position`; explicit width/height on every img; hero `fetchpriority="high"` eager,
  everything else lazy.
- Motion: hero image never reveal-animated (LCP); the H1 masks in; mosaic tiles clip-reveal on
  entry with 90ms stagger; panorama pans with scroll; hover scale 1.03 inside the frame.
- Reference set: muchbetteradventures (photo grounds + bottom scrim), the padel page (grain),
  the operator's page (the material itself).
- Guessability check: a trip page in this category is "hero photo, grid of twelve squares, list
  of inclusions". Here the twelve squares became one panorama plus four tiles of unequal size,
  and the inclusions sit on one plate with the packing list.

## Flows — booking (interaction-ux)
Entry: every `[data-book]` control opens the drawer; `?book=1` after login reopens it.
Steps (padel's state machine, adapted): loading → status error (retry + WhatsApp) → not open
(WhatsApp) → login (members only; the seat hangs off the account like padel) → WHO'S COMING
("Just me" primary; "Add friends" reveals up to three name fields, friends need no account) →
phone (asked once, only when we have no number: a 6 am bus needs a number) → pay (summary
line: date · Khasab · AED price × seats; Stripe embedded) → confirmed (date, pick-up, "the
confirmation and a calendar file are in your inbox; the pick-up point comes on WhatsApp the
week before") · sold out (WhatsApp; no waiting list for a one-off trip) · already in.
Fields: friend name (so the roster and the bus headcount have every person) · phone (reach you
about the 6 am pick-up). Nothing else. Browser Back walks the drawer; Esc and the scrim close.
Failure paths: a blocked or failed pay request shows a readable error above the retry, input
kept, WhatsApp offered; a session that expired routes to login and returns with ?book=1.
Action inventory, booking plate: Book my seat (primary) · sold out → "Message us" (WhatsApp) ·
help: WhatsApp line on the close band and in every drawer error.

## Motion sourcing
Register: expressive | Weight: light | Stack: vanilla | RTL: no
Slot: hero signature
Considered: hero-animations/14, hero-animations/19, hero-animations/16, hero-animations/11 (stretch), mouse-effects/3
Picked: none
Moves: the operator's fjord photograph, cut by the H1
Why: the hero is a still photograph cut by type and a plate over its seam; every candidate here is a grid or ring choreography that would fight the one wide image, and the stretch (hero-animations/11, a ring swing of cards) is the wrong object for a single plate.
Port: n/a
Slot: section seam
Considered: scroll-animation/45, scroll-animation/24, hover-effects/20, sliders/6
Picked: sliders/6
Moves: the operator's three landscape photographs of the fjords, stitched into one strip, and the operator's own schedule as the ruler above it
Why: sliders/6 is one flex track whose position is lerped by a driver; ported from drag to scroll it becomes the panorama (scroll-animation/45's glyph-masked wipe is a seam effect, not a passage; /24 pages whole sections, too heavy for a light build).
Port: no DOM copies of the data (three images, one track); rAF only while the stage is on screen; transform only; reduced motion renders the middle image still; images carry width/height.
Slot: gallery
Considered: sliders/13, hover-effects/7, grid-animations/5 (stretch), grid-animations/4
Picked: none
Moves: the mosaic tiles are their photographs at unequal sizes
Why: four tiles want one quiet entrance each (clip-path inset) and a hover scale inside the frame; grid-animations/4's cross-polygon open and grid-animations/5's cloned-image transition are showcase moves for a twenty-image wall, and the stretch would be the second signature on a page that has one.
Port: n/a
Slot: micro-interaction
Considered: hover-effects/7, hover-effects/20, mouse-effects/3
Picked: none
Moves: n/a
Why: the button contract from the padel page (lift on hover, 0.98 press, underline-draw links) is the house micro-vocabulary; nothing here needs a cursor or a repetition effect.
Port: n/a

## Anti-slop self-audit (self-graded)
swap PASS (their fjords, their schedule, the LFG plate) · signature PASS (the panorama) · combo
PASS (0 of 6) · theme PASS (house system) · content-fit PASS (the facts shape the ruler and the
plate) · divergence PASS (validate_build clean) · ground PASS (photo grounds, scrim, plate,
grain) · skeleton PASS (a wide band under a ruler reads as a passage without the words) · squint
PASS (the plate is the brightest thing after the H1) → **PASS**.
