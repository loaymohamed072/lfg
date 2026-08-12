# PADEL-DESIGN.md — lfgdubai.com/padel (Padel Tuesdays)

Preview build, 5 Aug 2026. NOT deployed. Register: EXPRESSIVE (declared).

## Message brief (copywriting lane)
- H1 (composed around): "Tuesday nights are for padel."
- Hierarchy: (1) LFG runs a weekly padel night, every Tuesday → (2) any level, rotation format
  makes fair games fast → (3) paid + limited, book this Tuesday → (4) fee covers court, balls,
  matchmaking → (5) same LFG community as the runs.
- Primary CTA: "Book My Tuesday Spot". Price placeholder 99 AED (Loay sets the real number,
  server-side in event_config like every LFG price).

## Composition & Architecture (web-composition-architect)
- Site type: event/campaign page inside the existing lfgdubai.com multi-page site.
  IA verdict: one page (site IA already exists; campaign checklist score 1/8).
- Section economy: 6 — Hero (poster + living ball) · This Tuesday booking strip · Format
  ("winner stays on", 3 steps) · What the fee covers · FAQ · Community cross-band + CTA repeat.
- Hero archetype: BESPOKE "Court poster" — monumental Barlow Condensed type-as-hero (A8-class)
  over an SVG padel-court line ground, with the LIVING OBJECT (R8): the LFG match ball resting
  in the hero. Beats L0: no media split exists; the type IS the poster and the ball is a
  character, not decoration. Logged as new archetype candidate: "court-lines type-as-hero +
  living object".
- THE ONE BOLD MOVE: **The LFG match ball** — an optic-yellow padel ball carrying the LFG mark
  that travels the entire page on a scroll-driven trajectory: rests in the hero, bounces off
  each section seam with squash-and-stretch, rolls across the format steps, and drops into the
  court of the final CTA. Vanilla rAF + waypoints (no lib), CSS-only squash at contact.
- Motion weight class: LIGHT (static-HTML site, no bundler) — vanilla JS scroll driver + CSS
  transitions/keyframes. No GSAP/Lenis introduced into a lib-free codebase.
- Motion package: baseline = directional reveal staggers per section (IntersectionObserver),
  H1 line mask-reveal on load, card lift + link underline hovers, CTA press states. L3
  signature = the ball trajectory. Reduced motion: ball parks in the hero (static), reveals
  become opacity-only, no trajectory.
- Spatial system: Barlow Condensed display clamp(64px→150px) lh 0.92 tracking -0.02em;
  heading gap law 2.5:1; eyebrow→H1 12px; H1→deck 28px (scaled to display); deck→CTA 32px;
  section padding 96/56; container 1160px; body Barlow 16-17px lh 1.55, measure ≤66ch.
- Mobile 390: H1 clamps to 64-72px over 3 lines, court-line ground simplifies to baseline +
  service line, ball trajectory reduced to edge bounces at seams, booking strip full-width,
  steps stack with left numeral rail.
- Divergence dials: D1 bespoke type-poster+object · D2 asymmetric steps w/ numeral rail ·
  D3 Barlow Condensed monumental (brand-locked) · D4 scroll-waypoint character · D5 ink +
  court blue + optic yellow (VIBRANT register — sport-derived) · D6 96px ramp · D7 court-line
  hairlines + grain · D8 no photography (code-crafted object carries it).
- validate_build.py: VERDICT PASS (no L0, no reuse warnings).

## Palette (color lane) — CORRECTED 2026-08-05, brand-locked to olive

**The first derivation was wrong and is gone.** It took its accents from the SPORT
(WPT court blue #1F5FA8/#123C6B/#79ABE2 + optic-yellow ball #D8F34A) and made both
systemic. Loay rejected it on the only ground that matters: blue has never appeared
in LFG's identity. A palette derived from the subject instead of the brand is a
research failure dressed up as an insight.

LFG is brand-locked: ink `#0A0A0A`, graphite `#131313`, white, olive `#999966`
(the accent already shipping in `app-assets/lfg-app.css` and `lfg-bootcamp-page.css`).
Olive splits into three steps by contrast job, because #999966 alone clears WCAG on ink
(6.70:1) but is APCA-weak (Lc 46):

| Token | Hex | Job | Verified |
|---|---|---|---|
| `--pd-olive` | `#999966` | fills, hairlines, rules, ground glows — never small text | 6.70:1 on ink |
| `--pd-olive-cta` | `#B3B38A` | CTA fill, with an ink label | ink-on-it 9.17:1, APCA 61 |
| `--pd-olive-text` | `#C9C9A8` | kickers, meta labels, the H1 accent word, link hovers | 11.69:1, APCA 72 |
| `--pd-olive-deep` | `#3A3A26` | deep ground tint replacing the blue washes | ground only |

Court blue is removed everywhere: the six section glows, the hero radial, the hero SVG
court strokes, and the `#0B0F16` blue-black gradient stop (now `#0E0E0B`, a warm ink).
The one surviving blue was the UA's default link colour on the logo anchor, killed with
a zero-specificity `:where(a)` rule.

**The ball's optic yellow is no longer a token.** It is a photograph of a real object,
appearing on the ball and nowhere else, so it reads as material truth rather than a
second accent competing with olive. Worth naming: olive is a desaturated yellow-green,
the same hue family as an optic ball, so the object and the brand rhyme without the
brand borrowing the object's chroma. Register exempt (brand-locked).
Launch note (from the judge's same-league check): the page ships type+vector only by
preview necessity. After the first real Tuesday, shoot the night (court under lights,
crowd, rally) and run those through editorial-image-treatment as the proof layer.

## Atmosphere package (Step 7)
- Base ground: house ink #0A0A0A as the night-court material, never bare: every section
  carries at least one layer.
- Layered sections: HERO = SVG court-line geometry (service boxes + net line, 8% white) +
  court-blue radial glow + feTurbulence grain overlay (0.05) + vignette. FORMAT = numeral
  rail + blue seam glow. CTA = full court rectangle re-drawn as the closing ground, ball
  lands inside the service box.
- Seams: court baseline hairline (hard line) alternating with blue gradient bleed; the ball
  bounce marks each seam.
- Ambient behavior: glow drifts subtly with scroll (transform on the rAF driver); grain static.
- Source: Padel Haus single-material full-bleed hero ground (ADAPTED: video → court-line SVG
  field), Tracksmith decorated-pseudo-element craft (CARRIED: low-opacity ::after underlines).

## Reference transfer (the contract)
Padel Haus (padel.haus, captured .references/padel-haus):
- CARRY: club-material color logic (the court surface IS the palette) → court blue washes + optic ball accent.
- ADAPT: full-bleed single-material hero ground (their video → our SVG court-line field + glow; no padel footage exists in repo).
- ADAPT: uppercase micro-label system (0.8px tracking) → Barlow 500 uppercase eyebrows, +0.08em.
- REJECT: bone/off-white light palette — lfgdubai.com is brand-locked ink-dark.
- REJECT: hero video — no owned padel footage; preview build.
Tracksmith (tracksmith.com, captured .references/tracksmith):
- CARRY: low-opacity pseudo-element hover underlines (::after 0.2-0.3) → nav + FAQ + inline links.
- CARRY: 10px/1px-tracked uppercase micro-buttons and meta chips → date/spots/price meta row.
- ADAPT: single warm accent used sparsely (their gold → our optic yellow, ball + CTA only).
- REJECT: serif display pairing — Barlow system is brand-locked.
Floor check: 6 carried/adapted across 2 refs; atmosphere census moves: 2 (hero ground material, pseudo-element decor). PASS.

## Asset floor (Phase D) — MET 2026-08-05, no longer a skip
Hero-grade asset = **a generated LFG match ball** (`app-assets/padel-ball-640.webp`,
higgsfield nano_banana_pro, batch of 4, cut out and brand-graded — full record in
`~/.claude/memory/reference_media_library.md`). It replaced the first version's
code-crafted CSS sphere, which read flat the moment it moved. Ground asset = generative
court-line SVG field + feTurbulence grain (algorithmic, no raster).

The earlier "Asset floor skip" claim is withdrawn: the skip was justified by "no
photographic register exists," but the signature object never needed a photo SHOOT, only
a photoreal render, and the generation lane could produce one all along. The remaining
photo layer (the room, the crowd, a real rally) still waits on the first real Tuesday.

## Motion — the ball's ballistics (rewritten 2026-08-05)
The first version lerped between waypoints and lifted the ball with a sine arc, which is
why it read like a sticker on a rail. It also carried a latent bug: each waypoint's floor
was measured at page-load scroll, so every anchor below the fold sat thousands of pixels
down and the ball spent the whole page pinned against its bottom clamp. The sine arc hid
it. Both are fixed; the floor is now derived at the scroll where the ball actually
arrives.

The trajectory is solved rather than eased. Horizontal velocity is constant (no drag over
a 12m flight). Vertical is a chain of parabolas whose apexes decay by e² and whose flight
TIMES decay by e, with e = 0.68, a pressurised padel ball off a hard court. Spin is tied
to the ball's own circumference over the distance covered. Impact squash scales with
landing speed and originates at the contact point, so the first bounce hits hard and the
fourth barely dents; the launch frame and the resting frame are exempt, because a
permanently squashed ball at rest is the tell that it is fake. The floor shadow is a
sibling element, not a child, so it stays on the ground while the ball rises, tightening
and darkening as the ball drops. Scroll remains the clock, so all of it scrubs backwards.

Verified empirically, not by eye (`coaching-app/scripts/qa-padel-ball.mjs`, 19/19): the
measured median apex ratio across 1,200 scroll samples is **0.44** against the model's
theoretical e² = 0.4624.

## Flows (interaction)
Booking strip: date auto-computed (next Tuesday, Asia/Dubai), price + spots meta, single CTA
"Book My Tuesday Spot" → existing run-register + run-pay embedded-checkout pattern (server-side
price from event_config; nothing priced client-side). PREVIEW: checkout drawer renders a
preview notice instead of live Stripe; wiring points at the existing /api endpoints, flagged
off until Loay enables padel in event_config. WhatsApp fallback link in FAQ + footer band.
Anti-slop audit (self-graded): swap FAIL-proof (court page is padel-native) · signature named ·
combo PASS · theme PASS · content-fit PASS · divergence PASS · ground PASS → VERDICT: PASS.

## Copy (final, voice-matched)
All section copy written in this file's build; house register: short declaratives, second
person, no exclamation marks, prices plain. See padel.html.

## Image Art Direction (editorial-image-treatment ruling)
- This page ships NO photography by design: the repo holds no padel imagery, and the
  signature visual is the code-crafted match ball (living object) + generative SVG
  court-line grounds. Per the skill's own illustration rule, vector art is not grained
  or duotoned; the feTurbulence grain is a GROUND texture layer, never on the object.
- Rasters on page: LFG nav logo (brand mark, untouched, alt="LFG") and the existing
  house OG image for shares. No stock, no generation needed for the preview; if Loay
  wants a padel-night photo hero after the first real session, that shoot routes
  through the full 7-step treatment then.
- Grade tier: n/a (no photo set). Motion: object motion owned by the composition's
  signature; reveals per motion package. A11y: ball + court SVGs aria-hidden, logo alt set.

## Excellence loop + QA
D2 judge + QA runner run on the local preview server before this page is called done.

## Flows block (interaction-ux contract, 2026-08-09 — the LIVE booking build)

**Flow: Book a padel night.** All steps live inside `#pdDrawer`; every step pushes a
history state so browser Back walks the drawer backwards and a final Back closes it.
Drawer state (email + answers) persists in localStorage `pd_book` so refresh/Back
never loses work. Esc and scrim-tap close; reopening resumes.

Entry points: hero CTA, `#book` strip button, nav "Book" (all `[data-book]`).

Steps:
1. **STATUS (implicit).** Page booted from GET `/api/padel-status`: enabled,
   resolved event date (next occurrence, 1h grace), location, price, capacity,
   spots_left, map_url. Disabled → page shows preview state (current behavior).
   Sold out → strip CTA becomes "Sold out for {date}" + WhatsApp line; drawer
   still opens to a waitlist-free honest message (no fake scarcity).
2. **EMAIL.** One field, `type=email`, `autocomplete=email`, ≥16px. Justification:
   payment receipt + account linkage; the ONLY typed contact field (name arrives
   from Stripe's own checkout form at fulfilment, like paid runs). Logged-in
   members (window.lfg session) skip this step entirely. CTA: "Continue".
3. **QUESTIONNAIRE (first-timers only).** Server decides: padel-pay POST without
   answers returns `needs_questionnaire` for an email/member with no
   `padel_profiles` row; returning players never see it. 5 screens, ONE chip
   question each, tap auto-advances, "2 of 5" progress, ← back per step:
   q1 played padel before (Never / A few times / Regularly / Competitively)
   q2 other racket sports (None / Casually / Seriously)
   q3 how often you play now (First time / Now and then / Weekly / Most days)
   q4 on court you can (Learning the rules / Keep a rally / Volley + smash / Run the match)
   q5 word that fits (Beginner / Improver / Intermediate / Advanced)
   Every answer feeds the level formula (server-side): score 0-14 →
   level = 1.0 + 0.4×score, snapped to 0.5, clamped 1.0-7.0. No free text.
4. **PAY.** Summary line restates the night in words ("Tuesday 12 Aug · 8 PM ·
   {location}") above the embedded Stripe checkout (same machinery as paid runs:
   embedded_page, redirect never, onComplete → GET verify `payment_status==='paid'`).
   Primary CTA inside Stripe carries the amount. In-app browsers (Instagram/TikTok)
   get the track page's proven fallback copy + open-in-browser guidance.
5. **CONFIRMED.** Restates day-date-time-location, what happens next ("Your court
   and match group drop before the night — you're matched to your level"), and the
   WhatsApp escape hatch (wa.me/971504264410, prefilled per house pattern).

Failure paths: sold_out (409) → honest sold-out state + WhatsApp; already paid
(409) → success-style "You're already in for {date}"; network/send fail → inline error,
input preserved, retry + WhatsApp fallback; Stripe blocked in in-app browser →
guidance state. All errors name the next step; none dead-end.

Ranking system (v1 scope, stated): questionnaire seeds `padel_profiles.level`;
admin roster can nudge any player ±0.5 (clamped 1.0-7.0) after watching them play;
court grouping sorts paid players by level desc into courts of 4 (last court may
hold 2-3, flagged). Match-result-driven Elo is explicitly OUT of v1; the level
nudge is the human-in-the-loop rating update.

Admin (view-padel): config card mirroring the runs sched-card (enabled switch,
datetime-local Dubai, location, price AED, capacity, map URL, tagline) saved to
event_config id=1 padel_* columns; roster = paid attendees for the selected night
(name, email, WhatsApp where known, level, first-timer badge) + CSV export; courts
panel groups by level with a regenerate button; ± level controls per player.

## Image Art Direction — UPDATE 2026-08-09 (real footage arrived)
The zero-photography ruling is superseded for ONE element: Loay supplied real
padel-night footage (master: ~/Desktop/LFG/video-masters/padel-v1.mp4).
- Placement: dedicated proof band `#real` between #included and #faq. The ball
  keeps the hero; the footage is proof, never signature.
- Asset: app-assets/padel-live.mp4 (720x1280, muted, 7.9MB, faststart) +
  padel-live-poster.jpg. Ships from Vercel (.vercelignore exception) until it
  gets a Bunny CDN slot; then the swap is one URL.
- Layout: portrait frame off-center left (max 420px), offset olive-soft plate
  behind (16px, hairline border) for depth — no shadows in this system. Copy
  column right. 390px: single column, frame at 72vw, off-axis inline start.
- Grade: tier 2 (saturate .85, contrast 1.06, brightness .92) + edge scrim
  gradient top/bottom so the frame seats into the ink ground. No duotone —
  real proof stays believable.
- Motion: .pd-reveal entrance; autoplay muted loop playsinline preload=none;
  IntersectionObserver pauses off-screen; prefers-reduced-motion = poster only
  (autoplay stripped in JS).
- A11y: aria-label on the video; no speech, muted, so no captions owed.

## Format update 2026-08-09 (Ahmed): King of the Court, Mondays 8:30 PM
Weekly night at Padel AE, Al Quoz (admin-editable in event_config like the
runs; map link derives from the location name). Four courts, 15-minute rounds,
win = up a court, lose = down. Only round winners bank points; padel_signups
.points holds per-night totals; admin roster banks +1/−1 per player and the
summary line shows the live top-3 podium. Level (padel_profiles) seeds the
STARTING courts; the ± level nudge remains the between-weeks rating update.
Every weekday surface on the page renders from the configured night.

---

# BOARD-DESIGN — /padel-board + /padel-score (King of the Court night ops)

Added 2026-08-12 for Monday 17 Aug. Two fixed-purpose surfaces, NOT marketing pages.

## Message brief (copywriting lane)
- The board answers three questions, in this order of urgency, for a player standing on a
  court 6 metres away with 3 seconds of attention: **"how long left?"**, **"who's on the
  Throne?"**, **"where am I next?"**. Everything else is decoration.
- Voice: scoreboard, not marketing. No sentences on the TV. Labels are single words in caps.
  The only full sentence anywhere is the empty state.
- H1 equivalent (the lockup): "KING OF THE COURT" under "LFG PADEL NIGHTS".
- Empty state (before teams are built): "Teams go up when the night starts." — states the
  fact and implies the wait, without apologising or explaining the software.
- Score page CTA: "Save score" (verb + object, never "Submit").

## Composition & Architecture (web-composition-architect)
- Site type: internal ops display + operator tool inside the existing multi-page lfgdubai.com.
  IA verdict: two single-purpose pages (multi-page checklist scores 0/8 — neither is a
  marketing surface, neither is indexed, both are one job each). `noindex` on both.
- **REGISTER: RESTRAINT (declared).** A board glanced at for 2-3 seconds from 3-8 metres in a
  bright venue is a legibility problem, not an expression problem: every layer of atmosphere
  or motion competes with the numbers. Expressive-register machinery (scroll engine, reveal
  choreography, an L3 signature) is not merely unnecessary here, it is actively harmful — the
  page never scrolls and nobody ever hovers it.
- **SIGNATURE OF STILLNESS (the restraint register's required move): THE THRONE.** Court 1 is
  not the other three court cards with a badge added. It is composed as a different object:
  double the card height, its own inner ground (olive-deep wash + court-line geometry visible
  through it), the two team names set in Barlow Condensed display at 2× the other courts, and
  a single hairline crown rule above it. It never animates. Its authority comes entirely from
  scale, material, and position — the three things that survive at 8 metres when motion and
  detail do not.
  *Why stillness serves THIS brand:* King of the Court has exactly one prize, and a board that
  renders four identical courts has no story on it. Making the Throne materially different
  means a player across the venue knows who is winning without reading a single number — the
  hierarchy IS the content. A board that moved constantly would say "software"; a board that
  sits still and simply IS the ranking says "this is the record."
- Section economy: 3 zones on the board — header lockup + clock (top rail) · standings (left
  38%) · courts (right 62%, Throne occupying the top half). No fourth zone.
- Hero archetype: bespoke **"broadcast rail"** — a fixed 16:9 canvas with a top rail carrying
  the lockup and the countdown, and a two-column body below it. Beats L0 (words-left/media-
  right) because there is no media and no reading order: both columns are simultaneously
  scannable indexes, which is the opposite of a split hero's sequential left-to-right read.
  Logged as a new archetype candidate: "broadcast rail + asymmetric index pair".
- Motion weight class: **LIGHT.** No library, no scroll engine, no reveal system. Exactly one
  motion event exists (below).
- Motion package (restraint): micro-feedback only. **The one event: a score landing.** When a
  match's final score arrives, that court card plays a single 420ms olive edge-flash
  (`cubic-bezier(0.22,1,0.36,1)`), and any standings row whose rank changed translates to its
  new position over 520ms with a settle. Nothing else on the board ever moves. Reduced motion:
  both become instant state changes, no transition. This is the entire motion budget and it
  fires only when something真 happened — which is exactly what a scoreboard should do.
- Spatial system: sized in `vmin`/`vh`, not px, so one build fits any TV. Display (countdown)
  clamp 7-9vh, lh 0.86, tracking -0.02em · Throne team names 4.4vh · standings team names
  2.6vh · court team names 2.2vh · labels 1.2vh caps +0.12em. Heading gap law 2.5:1 applied
  to the rail (space above lockup : below = 2.5:1). Row height 6.4vh minimum — the legibility
  floor at 8 metres, derived from broadcast practice, not from a desktop grid.
- Mobile (390px): the BOARD is explicitly not responsive below 900px — it is a TV surface, and
  a phone-sized scoreboard would be a lie about what it is for. Below 900px it shows a single
  line: "Open this on the TV. Score from /padel-score." The SCORE page is the mobile surface
  and is designed at 390px first: 4 stacked match cards, two 56px numeric inputs each
  (`inputmode="numeric"`), a full-width save button in the thumb zone, nothing above the fold
  but the current round and the first match.
- Divergence dials: D1 bespoke broadcast rail · D2 asymmetric index pair (38/62) · D3 Barlow
  Condensed (brand-locked) · D4 single-event micro-motion · D5 olive on ink (brand-locked) ·
  D6 vmin-derived rhythm · D7 court-line geometry + grain ground · D8 zero imagery (a
  scoreboard with photography on it is a poster, not a board).

## Atmosphere package (Step 7)
- Base ground: ink `#0A0A0A` carrying the padel page's own material, so the board reads as the
  same product as the site — never a bare hex.
- Layers (board): (1) court-line SVG geometry — service boxes + net line at 6% white, scaled
  to the full canvas so the board literally sits on a court; (2) an off-centre olive radial
  wash `at 22% 0%` (light comes from somewhere, per R7); (3) `feTurbulence` grain at 0.045;
  (4) a vignette pulling the eye to the centre split. The Throne card carries a fifth layer:
  `--pd-olive-deep` wash with the court geometry showing through at higher opacity.
- Seams: hairline `--pd-line` rules between standings rows and around court cards; the rail is
  separated by a single full-bleed hairline, not a filled bar.
- Ambient behavior: static. The ground never animates — see the register.
- Source: carried from the existing /padel hero ground (same SVG court field + grain), which
  is why the two surfaces read as one system.

## Reference transfer (the contract)
Premier Padel (premierpadel.com, captured 2026-08-12 → `.references/premier-padel`; note the
rankings URL 404s, so the capture is the site shell + its type system, which is the part being
carried):
- CARRY: broadcast display type logic — ultra-heavy uppercase at lh 1.0 with tight tracking
  (their h1 74px/74px, weight 900) → the countdown and Throne names, Barlow Condensed 800 at
  lh 0.86. This is the single most transferable move: sports type sets its leading to zero
  because a scoreboard is read as shapes, not lines.
- CARRY: uppercase micro-labels at 12px/1px tracking → the board's zone labels (LEADERBOARD,
  COURT STATUS, NEXT ROTATION) at 1.2vh +0.12em.
- ADAPT: their `section::before` decorated pseudo-element border-image → our hairline rail rule
  (same move — decorate the seam, not the box — executed with a rule instead of an SVG border).
- REJECT: white ground. lfgdubai.com is brand-locked ink-dark, and a white board in a dim venue
  is a lamp pointed at the players.
- REJECT: their `linear-gradient(in oklab, #000 → #1a1a1a → #000)` full-width wash — a
  symmetric centre-lit gradient is the "generated" tell R7 names; ours is off-centre at 22% 0%.
Padel Haus + Tracksmith (in-repo `.references/padel-haus`, `.references/tracksmith`, captured
2026-08-05 for the /padel build, re-read for this one):
- CARRY: the club-material logic — the court surface IS the palette → the board's ground is the
  court itself (service-box geometry), not a UI panel colour.
- CARRY: Tracksmith's low-opacity decorated pseudo-elements → the Throne's crown hairline and
  the row seams, both at 0.2-0.3.
Floor check: 6 carried/adapted across 3 references; atmosphere-census moves: 3 (court-field
ground, off-centre radial wash, decorated seams). PASS.

## Anti-slop self-audit (self-graded)
1. Swap-test — could this board sit on another brand unchanged? NO: the ground is a padel
   court and the Throne is this format's own rule. PASS.
2. Name-the-signature — "The Throne is a different object, not a badge." PASS.
3. Combo-test — centered hero? no. 3-card row? no. SaaS gradient? no. Inter? no. uniform
   rounded cards? no (Throne breaks the set). fade-up-only motion? no motion at all. PASS.
4. Theme-test — reads as a broadcast scoreboard, not a dashboard template. PASS.
5. Content-fit — the layout IS the format (8 teams, 4 courts, one Throne). PASS.
6. Divergence — previous ledger build was /padel: (bespoke court-poster type-as-hero, scroll-
   driven ball trajectory). This is (broadcast rail, single-event micro-motion). No repeat.
   Display face repeats (Barlow Condensed) — justified: brand-locked, and the two surfaces are
   deliberately one system. PASS with stated justification.
7. Ground-test — replace every background with one hex and lose nothing? NO: the court field,
   the off-centre wash, and the Throne's inner ground all carry meaning. PASS.
VERDICT: PASS (self-graded). Independent judge re-checks the rendered board at Phase D2.
