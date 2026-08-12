# Kahunas Teardown — what LFG's platform must replace (and beat)

**Source:** live walkthrough of Ahmed Sam's real Kahunas coach account (kahunas.io), 2026-07-03. Read-only; nothing was created, edited, or sent.
**Screens:** `./screens/kahunas-01…19.jpeg` (numbered in walkthrough order).
**PII warning:** screenshots contain real client names, emails, phones, and health data. Keep this folder out of git and out of any AI corpus (handoff §10 privacy rule).

---

## 1. Account facts (Ahmed's live usage)

- 34 active clients, 15 archived, 49 total records. ~3 new clients in the last 7 days.
- Stripe connected (automatic weekly payout, Monday). PayPal tab exists, unused.
- 18 packages live, AED 899–4017: mix of monthly subscriptions (899/900/1100/1300/1545) and one-time programs (3900 for 3 months, 4017 for 13 weeks, Ramadan 945). One "Initial payment then subscription" hybrid (3899 for 91 days, then 899/mo). One personalized single-client package.
- ~17 coupon codes in active use (percent-off, amount-off, once/forever, expiry, redemption caps). Coupons are clearly part of how Ahmed closes.
- White-label mobile app **already shipped through Kahunas**: "LFG Coaching" (black #000000 branding, app-store updates take 10–12 days via Kahunas). The app shows: daily check-in streak calendar, "your check-in is today" card, next workout, goal countdown (weeks/days/hours), weight progress, water tracker (default 3L goal).
- Check-in cadence: weekly on Sundays (most clients) + daily check-ins. The dashboard feed of "latest check-ins" and "latest messages" is Ahmed's daily working surface.

## 2. Module-by-module inventory

### 2.1 Coach dashboard (`/dashboard`) — screen 01
- KPI-free; three feeds: Latest Clients (package, progress %, check-in day), Latest Check-ins, Latest Messages.
- Quick actions: Add Client, Add Workout Program, Add Nutrition Plan.
- No revenue, LTV, churn, or alerts. (Handoff module 6 beats this easily.)

### 2.2 Clients CRM (`/coach/clients`) — screen 02
- Stats bar: active / archived / new (7d) / deactivated (7d) / new check-ins / new messages / renewing next 7 days.
- Table: package, last check-in, check-in day, progress % bar (weeks elapsed), status badges ("Offline Payment", "Ongoing"), Actions dropdown. List/grid toggle, filter, search, broadcast message to many clients.
- Pagination 12/page. No pipeline/lead stage, no tags visible, no lapsed-risk flag.

### 2.3 Client profile (`/coach/clients/view/{uuid}`) — screens 03, 16
- Header: avatar, email/phone, payment badge, check-in day, package, total weeks, start weight, current weight, age; second row: Sleep, Wellbeing, Stress, Anxiety, Readiness scores (from daily check-ins; blank if unused).
- Icon strip: water, stats/charts, health metrics, goals, notes, chat, edit.
- Tabs: Dashboard / Checkins / Gallery (progress photos) / Q&A (onboarding) / Nutrition / Supplements / Workout / Calendar / Daily Habits / Logs / Billing.
- Dashboard tab: Activity log (every check-in, plan change, email event), Client Notes, Latest check-ins, Client Data (weight & energy latest entries with % deltas).
- Quick-assign buttons: Workout Program, Nutrition Plan, Supplement Plan, Check-in form, Habit form.

### 2.4 Check-ins — screens 04, 10
- **Weekly check-in (Ahmed's primary form):** workout-progress traffic light (Green/Amber/Red), diet traffic light, wellbeing 1–10, weight, body fat %, muscle mass, 7 tape measurements (L/R arm, waist, glutes, L/R thigh), energy 1–10, free text (weekly summary/wins, advice-to-self, "anything you're struggling with that needs my immediate help?"), photo uploads (clients upload InBody scans), optional check-in video.
- Coach view: Reply (goes to chat), **Compare with previous check-in**, jump to any older check-in, "Complete Check in" state.
- **Form builder:** 10 forms in Ahmed's library (weekly ± measurements, daily general, daily weight-loss, HYROX variant). One default weekly + one default daily; toggle status per form. Q&A/intake uses the same engine.
- Daily check-in feeds streaks + the Sleep/Wellbeing/Stress/Anxiety/Readiness header scores.

### 2.5 Workout builder (`/coach/workout_programs/new`) — screens 05, 06
- Three creation modes: **Simple**, **Detailed**, **Upload PDF/Excel**.
- Detailed: program title, tags, overview; day tabs (add/duplicate day); per-day Warm up / Workout / Cool Down sections; exercise picker drawer (search, video-demo exercise library with default sets/reps, custom-exercise creation, **Superset** and **Circuits** tabs); per-day instructions.
- Client side logs sets/reps; "Workout Reply" messages thread into chat (seen in Latest Messages).

### 2.6 Nutrition (`/coach/diet_plans/…`) — screen 07
- Three modes: **Full meal plan** (meals → foods from database, live day totals kcal/P/C/F), **Macro-only plan**, **Upload doc**.
- TDEE calculator built into the builder. Meal templates ("Add meal from template"). Plan notes + tags.
- Client app has a nutrition logging diary (toggleable per client), verified-foods-only mode, micronutrient display.

### 2.7 Supplements
- Separate supplement-plan builder + per-client Supplements tab. (Not deep-dived; same assign pattern.)

### 2.8 Daily habits
- Habit form builder (`/coach/daily_habits/new`) + per-client Daily Habits tab; drives the app's daily checklist + streaks.

### 2.9 Packages & payments (`/coach/packages`) — screens 08, 09, 18
- Package = title, description, price, currency, type (subscription / one-time / initial-payment-then-subscription), billing period, visibility, active toggle, client count.
- **Shareable public link** per coach (all visible packages) + per package, plus an iframe embed snippet for any website.
- Coupons: code, % or AED off, once/forever, expiry, redemption cap, per-package redemptions.
- Stripe checkout; "Offline Payment" badge exists for clients paying outside Stripe (cash/transfer) — Ahmed uses this a lot.
- Billing tab per client; renewals surfaced in CRM stats ("renewing next 7 days").

### 2.10 Public funnel (the flow Ahmed sends leads) — screens 18, 19, 16
1. **Package page** (public, LFG logo, feature checklist per package, Purchase buttons).
2. **Register** ("Welcome To Ahmedsam" — note: Kahunas prints the coach *username*, weak branding): first/last name, email, password with strength rules, **"I agree to the Terms and Conditions"** checkbox, reCAPTCHA.
3. **Stripe payment** for the chosen package (or coach sends a direct payment link).
4. **Initial Q&A onboarding form** (the "KYC"): weight, height, DOB, 7 tape measurements, body-fat estimate, long-term goal (12 months), short-term goals (12 weeks), meals/day, allergies/intolerances, problem eating patterns, average steps, equipment access, organization 1–10, what/why change, what you're prepared to do, motivation level, **commitment agreements** ("I agree" items: fill daily checklist, log workouts in app, submit Sunday check-ins before starting the day, ask questions in the coaching group), date, photo uploads (InBody).
5. Client lands in the app; coach gets triggered emails.
- Coach can Edit Answer / Reset Q&A / Download the questionnaire per client.

### 2.11 Automation (`/admin/trigger_list`) — screen 14
- Email sequences on 13 triggers: new client created, check-in completed, initial Q&A completed, plan added/updated (workout/nutrition/supplement), **client misses a check-in**, check-in reminder, birthday. Ahmed has 6 enabled.
- Email only. No WhatsApp (Ahmed's actual channel), no SMS, no in-app push config here.

### 2.12 Other
- **Content Library** (`/vault/manage`): folders/files with per-client permissions (Ahmed: Videos, Nutrition guides, Fitness Planner PDF, App Manual PDF).
- **Calendar** (`/coach/calendars`): booking/appointments per client (client tab exists too).
- **Chat** (`/chat/message`): 1:1 threads, workout replies threaded in, broadcast from CRM. No group chat visible ("coaching group" lives on WhatsApp).
- **Settings** (`/coach/configuration`): Stripe/PayPal, units (kg/cm/grams/L, glucose mmol), logbook window, timezone, **DNS settings (custom domain support)**, notification settings, video-library settings, nutrition toggles, client-metric visibility, water tracker, load calculator (1RM estimates).
- **My App** (`/coach/myapp`): white-label app config — name, description, brand color, screenshots; store updates via Kahunas take 10–12 days.

## 3. Where Kahunas is weak (the 10x gaps)

1. **Zero intelligence.** No AI anywhere: no client summaries, no check-in analysis, no plan generation, no next-best-action. Ahmed reads every check-in raw and writes every plan by hand. → **The Coaching Brain is the whole differentiator: auto check-in summaries, red-flag detection, plan drafts in Ahmed's templates, weekly client briefs.**
2. **Dashboard is a feed, not a cockpit.** No revenue, MRR, LTV, churn risk, lapsed-client alerts, or "who needs attention today" queue. → Owner dashboard (handoff module 6) + a daily triage queue ranked by risk/urgency.
3. **Fragmented daily workflow.** Check-in review, reply, plan tweak, and notes are 4 separate screens. → One review screen: check-in + trends + AI summary + reply + plan adjustments in a single flow.
4. **Automation is email-only.** Ahmed's clients live on WhatsApp. → WhatsApp-first automations (reminders, missed check-in nudges, renewal notices) via the existing GHL pipeline.
5. **Weak funnel branding.** "Welcome To Ahmedsam", kahunas.io URLs, generic checkout. → Fully LFG-branded funnel on coaching.lfgdubai.com, offer pages that sell (proof, transformations), one continuous register → pay → onboard flow.
6. **No community/group layer.** "Weekly education inside private coaching group" is sold in every package but happens off-platform. → In-app group space or at least first-class WhatsApp group integration + content drops.
7. **Progress data is under-used.** Measurements, photos, InBody uploads exist but no trend intelligence, no phase detection, no auto flags (plateau, rapid loss, missed protein). → Trend engine + guardrail flags from `ahmed-method` (injury, PCOS, IBS, cycle, postpartum, ED history screens).
8. **App update latency.** 10–12 days per store update through Kahunas. → PWA first (instant updates), Capacitor wrap through Ahmed's own dev accounts (handoff Phase 3).
9. **No lead/CRM stage before purchase.** Kahunas starts at checkout. → Lead capture + GHL pipeline from the LFG community (run club → coaching funnel is the ecosystem advantage).
10. **Offline payments are a badge, not a flow.** Cash/transfer clients show "Offline Payment" with no invoicing/receipts/renewal tracking. → Proper manual-payment records with renewal dates and reminders.

## 4. Feature parity checklist (MVP must-haves to not regress from Kahunas)

Ahmed actively uses ALL of these today; missing any one blocks cutover:

- [ ] Packages with subscription + one-time + initial-then-recurring pricing, coupons, shareable/embeddable checkout links, Stripe + offline-payment marking
- [ ] Register → T&C consent → pay → onboarding Q&A funnel (his exact intake questions, incl. commitment agreements + photo uploads)
- [ ] Weekly check-in form (his exact fields: traffic lights, 1–10 scales, weight/BF/muscle, 7 measurements, free-text 3 questions, photos) + daily check-in + form builder with multiple forms
- [ ] Check-in review: compare with previous, reply-to-chat, history, complete/pending states
- [ ] Workout programs: multi-day builder, exercise library with videos, supersets/circuits, PDF/Excel upload fallback, client logging + workout replies
- [ ] Nutrition: full meal plans + macro-only plans + upload, TDEE calc, food logging diary in app
- [ ] Supplement plans + daily habit checklists with streaks
- [ ] Client profile: vitals header, tabs (check-ins, gallery, Q&A, nutrition, workout, habits, logs, billing), notes, activity log
- [ ] Chat 1:1 + broadcast; water tracker; progress photos gallery
- [ ] Email triggers (new client, check-in done/missed/reminder, Q&A done, birthday) — upgrade path: WhatsApp
- [ ] Content library with per-client permissions
- [ ] Client mobile app: daily checklist, streaks, check-in day, next workout, goal countdown, weight & water widgets (PWA first)
- [ ] Coach settings: units, timezone, check-in days per client, metric visibility toggles

## 5. Migration notes (feeds handoff §9)

- Export needed from Ahmed: clients (34 active + 15 archived), their Q&A answers, check-in history, current program state, package/billing status (who's mid-installment), coupon list.
- Client identifiers are UUIDs; email is the join key against LFG `members` (run-club overlap confirmed: several coaching clients are known LFG community names).
- Active subscriptions live in Ahmed's own Stripe (connected account) — confirm whether subscriptions were created on Ahmed's Stripe or Kahunas' platform account; if Kahunas', subs must be recreated at cutover (client re-consent needed).
- Preserve: check-in numbering/history (clients are at "44th check-in" etc.), progress photos, weight series.

## 6. Suggested next steps

1. Confirm with Ahmed which Kahunas export formats are available (CSV/PDF per client?) and get the Stripe account question answered (5 above).
2. Lock MVP = §4 parity checklist + Coaching Brain panel (per handoff §12 Phase 1).
3. Design the coach's **daily triage screen** first (check-ins to review + AI briefs), it replaces 80% of Ahmed's Kahunas time.
4. Build the funnel (packages → register/consent → Stripe → onboarding Q&A) as one branded flow on coaching.lfgdubai.com.
