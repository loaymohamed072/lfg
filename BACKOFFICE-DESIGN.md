# BACKOFFICE-DESIGN.md — LFG back office (run-club admin + coach console)

One skeleton, two skins. Both back offices Ahmed and Omar switch between share one shell, one motion grammar, one token set; each wears its own photo so the eye knows which office it is in. Source of the grammar: `codexr-ui-lab` (dashboard-skins, dashboard-choreography, glass-navigation), chosen by Loay on 2026-10-26. Brand: `design/LFG-DESIGN-PLAYBOOK.md` (locked). Status: PREVIEW on branches `admin-upgrade` (this repo) and `coach-upgrade` (lfg-coaching-app). Nothing deploys from these branches.

## Design contract

- THESIS: The back office is the club at night: the crowd and the city behind glass, the numbers in front, sharp and countable.
- OWN WORLD: LFG's own night-run crowd under the Burj (admin) and the bootcamp floor's ceiling LED strips (coach), blurred into light; Barlow Condensed numerals; olive on ink.
- STORY: Sign in, the rail and cards build once, numbers count up to today's truth; after that every click answers inside 100 ms; during live check-in, arrivals glide from Not yet to Here.
- FIRST VIEWPORT: City lights through a glass rail, a headline that names the next Sunday's turnout ("7 booked for Sunday"), one olive revenue tile carrying this week against last week, five ink tiles, and the live check-in board with its station map.
- FORM: 14px ink cards, glass only on rail, top pills, popovers and the assistant button, capsule controls and tags, hatched remainders for empty places.

## Register, mode, challengers

- Register: expressive atmosphere, Operate behaviour. The ground and glass carry the personality; motion only where it informs (build once per session, numbers that changed, arrivals, the active pill). Interaction-ux §10 rule kept: a tool loads into a task, so entrances play once per session.
- Visitor mode: Operate on every view (admin 15 views, coach 22 pages).
- Challengers (seed `lfg-backoffice-2026-10-26`): A5 quiet-gallery restraint (flat ink, no ground): lost, it is today's admin and reads as a spreadsheet; A9 full-bleed photo with type over it: lost, data over a sharp photo fails legibility; unlisted "the roster board" (a door-staff style split board as the home): kept as the Today live check-in block, not the whole shell.
- Signature moments: (1) **Arrival**: the live board draws the session's stations from the Sunday roster (A-D, eight places each: olive for here, a ring for booked, a faint dot for open); when a runner scans in at the door, their row glides from Not yet to Here, their station's ring fills, and a toast names them and the station (derived from the real Sunday scan-in and roster split). Both lists hold room for every booked runner, so an arrival moves one row across and nothing else on the page; the room still to fill is hatched. (2) **The build**: first open of a session, rail then shells then numbers counting to the real values (codexr shells-then-content). (3) **Night ground**: the club's own night photo as the light behind the glass.

## Shell composition

- Admin: floating glass rail (16px inset, 20px radius) with 15 line-icon nav items and a sliding olive pill; main column with the page title on the ground (no card), glass action pills top-right (Coaching admin, Refresh); content cards solid ink. Each view has one olive hero tile, label above the number: Today's revenue (with this week against last week as two bars), Overview's all-time revenue.
- Coach: same rail and rail type (condensed uppercase) with the 17 links grouped TODAY (Queue, Bookings, Inquiries, Messages) · PEOPLE (Clients, Leads, Groups, Comeback) · BUILD (Training, Nutrition, Forms, Library) · BUSINESS (Packages, Payments, Notify, Settings); footer: Report a problem, Run club admin, Sign out. The coach's one olive tile is the 14-day check-in rhythm on the queue: the 14-day total, its bars, and this week against the week before. The assistant (Sammy) lives in the chrome, never on a page: a capsule in the rail's brand row on laptops, an icon in the top bar on phones; its panel opens beside it.
- Spatial system: 4px base; card padding 20/22; grid gap 14; section gap 28; page title 34px Barlow Condensed 900 uppercase, -0.01em, sub 13px paper-2, title→sub 4px, header→content 24px (2.5:1 above:below kept by the 60px top pad vs 24px). Radii: cards 14, inner fields 10, chips/pills 999, rail 20, modal 18.
- Mobile (≤ 960px): rail becomes a sticky glass top bar in two rows on both surfaces: brand and icons on top, the horizontally scrolling pill nav with the same sliding pill underneath; content cards single column under 600px, KPI tiles stay two-up (Today's revenue and next-session tiles span the row); page title 28px on both surfaces, the coach header's counts dropping under the title.

## Motion package

- Personality: a coach's stopwatch: quick, exact, front-loaded; numbers are the slowest thing on screen so the eye lands on them last.
- Family (captured from the codexr references, `capture.mjs` + demo source): quart-out `cubic-bezier(.25,1,.5,1)` for pills and resolves; cubic-out for words; route exits are cuts and the incoming page rises in 260 ms; durations: press 120, hover 140, pill 440 (rail 200 for vertical), shell 240 (blur 7→0, card-sized only), content +190 then 50 apart, count-up 1,400 quart-out, bars 80 ms per column.
- Vocabulary chosen: shells-then-content (once per session), count-up from the last value seen (values under 10 just appear; on the coach a page's first visit in a session counts up from zero once its plate lands), chart draw-ins on first open of a view, sliding active pill + hover layer (pointer devices), toast announcer with width morph, arrival glide (FLIP), press feedback on every control. Not chosen: smooth scroll, magnetic CTA, theme mask (one theme), route blur-out (exits are cuts).
- Reduced motion: opacity-only 160 ms fades with delays compressed to 35 %; no blur, no displacement, counters land instantly; pill jumps.
- Perf clamps: animate transform/opacity/clip-path (+ filter only on empty card shells under 240 ms); one fixed ground layer; glass panes: rail + top pills + toast only; no scroll handlers.
- Weight class: light (vanilla WAAPI + CSS on admin; CSS + one small client module per feature on coach). No new motion library.

## Atmosphere package

- Base ground: ink `#0A0A0A` under a fixed photo layer. Admin: `main group photo.jpeg` (night run, Burj, city lights). Coach: `selfie in bootcamp.jpeg` (gym LED strips). Each pre-graded and pre-blurred offline (sigma ~28 px at 1600 px wide) so faces cannot be recognised and lights read as bokeh; served as one small WebP.
- Ground hue: deep (ink) with a faint olive cast from the grade; source: the playbook grade (contrast 1.07, saturate .9, brightness .9) pushed darker for legibility.
- Layers: photo → ink scrim (top 30 %, bottom 55 %) → vignette radial → film grain overlay 12 % (fixed pseudo-element, pointer-events none).
- Seams: none needed; the ground is one fixed plane and cards float on it. Scroll-edge fade under the mobile top bar instead of a hard border.
- Ambient behaviour: static. No parallax, no loops.

## Reference transfer

References captured this session with `capture.mjs` into `.references/`: `codexr-dashboard-skins`, `codexr-dashboard-choreography`, `codexr-glass-sidebar`.

- dashboard-skins: CARRY scene ground under glass chrome → admin and coach grounds (atmosphere). CARRY glass recipe `blur(18px) saturate(165%)` + inset top rim `rgb(255 255 255 / .26)` + bottom rim + `0 12px 32px -12px` lift → rail and top pills (atmosphere). ADAPT the radial vignette `radial-gradient(120% 92% at 50% 40%, transparent 55%, …55%)` → retuned to ink at 60 % over the photo (atmosphere). CARRY hatched remainder `repeating-linear-gradient(135deg …)` → empty places in session-fill bars and the Today hero fill bar. CARRY toast width morph via clip-path on the toast background → admin toasts. ADAPT the coral hero card → one olive-bright hero tile per view (brand accent, ink text). REJECT the bottom dock nav: 15 and 17 destinations exceed a dock's 3-5; a rail serves them.
- dashboard-choreography: CARRY the timing table (shell 50 + 65/slot, content +190/50, count 1,400) → view entrances. CARRY counter split (aria-hidden ticking digits + visually hidden final value) → every count-up. CARRY clipped pill track → mobile pill nav. ADAPT route swap: exit stays a cut (the app hides the old view itself), entrance shortened after the first visit of a view. REJECT the organic theme mask: LFG has one theme.
- glass-sidebar: CARRY grouped sidebar with section labels and a sliding hover highlight (130-150 ms) under the active pill → coach rail and admin rail. ADAPT the wallpaper: their ember arcs become LFG's own photos. REJECT collapse-to-rail for now: both rails need labels (17 items, no icon-only reading yet).

## Motion sourcing

Register: expressive | Weight: light | Stack: vanilla | RTL: no
Slot: page transition
Considered: page-transitions/6, page-transitions/3, page-transitions/4 (stretch), navigation-menus/13
Picked: none
Why: an operate tool opened 40 times a day needs a cut plus a short build, and the codexr route-swap the client chose does exactly that; the slice, layer and pixel wipes (stretch page-transitions/4 lost here) are marketing-site theatre that would tax every click.

Slot: nav
Considered: navigation-menus/8, navigation-menus/16, grid-animations/6, navigation-menus/10 (stretch)
Picked: none
Why: these are full-screen menu curtains; a back office keeps its nav on screen, so the codexr sliding pill + hover layer is the move; the circular clip reveal (stretch) solves a menu we do not have.

Slot: micro-interaction
Considered: hover-effects/2, hover-effects/7, mouse-effects/3, hover-effects/3 (stretch)
Picked: none
Why: char scatter and image-repetition hovers belong on portfolio cards; dashboard controls get the button contract press (scale .98, 120 ms) and numbers that count; the pixel hover (stretch) would fight data legibility.

Slot: atmosphere ground
Considered: scroll-animation/33, scroll-animation/5, 3d-animation/18, hero-animations/11 (stretch)
Picked: none
Why: every candidate is scroll-driven; an operate surface keeps a static ground, built from the club's own photo per the playbook recipe; the entrance plate (stretch) would replay on every visit.

## Image Art Direction

- Job: atmosphere ground only; no content imagery added. Decorative: `aria-hidden`, CSS background on a fixed layer, never the LCP element.
- Grade tier: 5 (full darkening + desaturation + blur) because the photo serves as light, not as a picture; faces become unrecognisable.
- Crop: admin `object-position` 50% 62% (crowd and skyline lights in the lower half); coach 50% 30% (LED strips in the upper half).
- Engineering: ffmpeg grade + Gaussian blur at 1600 px wide → WebP q~70 (target under 80 KB), JPEG fallback not needed (WebP is universal in the browsers the team uses; the ink base colour shows if it fails).
- Source and licence: LFG's own event photography already shipped on lfgdubai.com (`main group photo.jpeg`, `selfie in bootcamp.jpeg`).
- Guessability check: a stranger could not predict this from "admin dashboard"; the ground is LFG's own night.

Asset floor skip: real LFG photography is the material for both grounds; the LFG playbook allows AI imagery only when no real photo exists, and these photos exist and already ship on the public site.

## Tokens

```json
{
  "color": {
    "ink": "#0A0A0A", "card": "#131311", "raised": "#1B1B18", "pop": "#232320",
    "paper": "#F4F1E9", "paper-2": "#B9B6AD", "paper-3": "#8E8C85",
    "olive": "#999966", "olive-bright": "#C2C28A", "on-olive": "#0A0A0A", "on-olive-2": "#26261A",
    "good": "#AECB85", "watch": "#DCB878", "flag": "#EAB4A8", "coral": "#E0655E"
  },
  "font": { "display": "Barlow Condensed", "body": "Barlow" },
  "radius": { "card": 14, "field": 10, "pill": 999, "rail": 20, "modal": 18 }
}
```

Contrast (build_palettes.py --check, 2026-10-26): paper/card 16.48:1, paper-2/card 9.17:1 (APCA 62), olive-bright/card 10.08:1, ink/olive-bright 10.73:1, on-olive-2/olive-bright 8.28:1, good/watch/flag text on card ≥ 9.89:1. Coral is a fill and border colour only (APCA 40 as text).

## Flows (interaction-ux)

- Sign in (admin): email, password, captcha, one primary "Sign In"; pending label "Signing in…" stays in the button; error stays under the field and keeps the email typed. Unchanged logic.
- Views: every nav click updates the URL hash (`#overview`), so browser Back moves between views and a reload opens the same view. Back from the first view leaves the admin as before.
- Feedback: success toasts close themselves after 4.5 s and pause while hovered or focused; error toasts stay until closed and carry a Close button; the "code created" toast stays and offers Copy code. Confirm dialogs stay for refunds, deletes, sends and reconcile (irreversible).
- Live check-in: the board refreshes every 20 s (unchanged) and its feed starts with the Today numbers, not after them; arrivals glide and announce through a polite live region.
- Late data holds its place: the live board and the abandoned-checkout card show as plates of their last height in this browser from the first frame (the board also waits, 3 s at most, for the session's station places, so it lands whole); a signed-in reload paints Today's headline as a plate until the next session's numbers write it.
- Action inventory per view is unchanged from production (no control added or removed except the toast Close/Copy and the Overview "Show all" toggle on the abandoned-checkouts list).
- Modals (admin): Escape presses the modal's own Close or Cancel, focus moves into the dialog on open and returns to the control that opened it. Sortable promo-code headers and the "Lapsed · tap to view" tile are keyboard controls.
- Coach: rail links keep `aria-current`; the pill moves on press before the page arrives, and Back or Forward re-syncs it; each section shows a layout skeleton at once (`loading.tsx`). Every page shares one left edge: the main column fills the space beside the rail up to 66rem. On a check-in, the WhatsApp-window note and the send buttons land once, with their true label, when the window is known (at most 1.5 s); their row keeps its height while they wait.

## Sprint contract (QA and the D2 judge verify these)

1. First load builds chrome → shells → numbers once per session; later view switches resolve under 300 ms with nothing blocking input.
2. Every control shows press feedback within 100 ms and a 2 px olive focus ring.
3. Overview charts draw in when the tab opens; Refresh changes values without redrawing from zero.
4. A runner moving Not yet → Here glides across and a toast names them.
5. No `alert()` popups remain in admin.html.
6. Browser Back moves between admin views; reload keeps the view.
7. Reduced motion keeps every state visible with no displacement or blur; reduced transparency swaps glass for solid.
8. Every existing view loads its data with zero console errors.

## Anti-slop self-audit (self-graded)

Swap test PASS (LFG's own night photo, condensed numerals) · signature PASS (Arrival) · combo test PASS (no centered hero, no purple, no Inter, motion is not fade-up-only) · theme test PASS · content fit PASS (IA untouched) · divergence FLAG: glass rail repeats the 19 Sep /me dock material, justified as one family across LFG products · ground PASS · skeleton PASS · squint PASS (olive hero tile lands first). Verdict: PASS (self-graded).
