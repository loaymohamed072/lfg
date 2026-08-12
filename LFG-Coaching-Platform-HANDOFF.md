# LFG Coaching Platform — Build Handoff

**For:** a fresh chat starting the build. Read this top to bottom, then start with "Suggested build order" at the end.
**Owner:** Loay (Komplete). **Client:** Coach Ahmed Sam, LFG Dubai. **Date packaged:** 2026-07.

---

## 1. What we're building (one-liner)

A **custom online-coaching platform for LFG that replaces Kahunas**, on `coaching.lfgdubai.com`, plus a **mobile app** shipped through Ahmed's own app-store developer account, with the already-built **LFG Coaching Brain (AI copilot)** wired in. Ahmed owns his stack and data; Komplete keeps the reusable IP to sell to other gyms later.

**Architecture decision (made):** build it as **one ecosystem with the existing LFG platform** (shared member accounts + CRM), but give coaching its own dedicated space at the `coaching.lfgdubai.com` subdomain. Do NOT build a disconnected second system — the whole value is the LFG community funnelling into coaching.

---

## 2. Commercial context (so scope stays honest)

- Deal shape: **~AED 5,000 one-time build** (2.5k start / 2.5k on app launch) + **~AED 850/mo** (hosting, maintenance, updates, AI usage — fair-use note on heavy AI months). Komplete **retains IP + reuse rights** (Ahmed is "client zero" of a productised platform). Barter: testimonial + case study + referrals.
- Because Komplete keeps the IP: **build it generically enough to re-skin for other coaches later.** Brand/theme should be config, not hardcoded.

---

## 3. What already exists (build ON these, don't rebuild)

Repo root: `~/Downloads/lfg/` (git repo, branch `test`).

- **The AI Coaching Brain — DONE.** `~/Downloads/lfg/coaching-brain/` (46 markdown files):
  - `00_SYSTEM_PROMPT.md` (master copilot prompt), `INDEX.md` (retrieval map), `README.md` (architecture + integration notes).
  - `ahmed-method/` (10 files: his real philosophy, discovery, onboarding, programming, nutrition, voice, retention, sales, **09 = his real nutrition-framework template**, **10 = his Active IQ credentials**).
  - `knowledge/` (training, nutrition, behavior-coaching, assessment) + `knowledge/_book-notes/` (NASM, Precision Nutrition, Helms, Aragon, Schoenfeld, Miller, Coaching Habit distillations).
  - `playbooks/` (6: client_summary, next_best_move, nutrition_plan_builder, workout_builder, client_situation_handler, deal_advisor).
  - **All client PII stripped.** Do not re-introduce real client data into the corpus.
- **Existing LFG platform** (the run-club/bootcamp booking system): static HTML + Vercel serverless functions in `api/` + Supabase + Stripe + GHL + Bunny CDN. This is the run/bootcamp side. Coaching is the NEW module on top. See `~/Downloads/lfg/_MAC-HANDOFF.md` for how that stack runs (dev server `npm run dev`, port 8080).
- **Business plan + proof docs** (context for scope/pitch): `LFG-Business-Plan/LFG-Coaching-Platform.pdf` (the platform pitch, the six-module model, the offer ladder), `LFG-Coaching-Plan-Proof.pdf` (a live sample of the brain producing a full plan — this is the target output quality for the platform's plan generator).

---

## 4. Current stack & infra (real, verified)

- **Existing site:** plain HTML/CSS/JS + Vercel serverless (`api/*.js`), no build step. Hosted on Vercel.
- **Supabase (LIVE production):** project id `mqhrjliqjxcxtzorapiy`. Keys in `.env.newprod` (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`). The OLD project (`.env` `SUPABASE_URL`) is dead — use `.env.newprod`.
  - Existing tables: `members, bookings, payments, member_packages, sessions, packages, run_rsvps, run_registrations, run_attendance, reviews, merch_orders, promo_codes, promo_redemptions, point_awards, visits, lead_touch, credit_adjustments, event_config`.
  - Auth: Supabase magic-link + Google OAuth (passwordless). **Reuse this for the coaching login** so members have one account.
- **Payments:** Stripe (checkout, webhooks, credit packs). Reuse the Stripe account.
- **CRM:** GoHighLevel (GHL) integration in `api/_ghl.js`. Coaching events should push to the same GHL pipeline.
- **Secrets:** `.env`, `.env.newprod` in repo root (gitignored). Master index at `~/.claude/memory/reference_secrets.md` and `~/.config/secrets/`. Never print/commit secrets.
- **Node:** use Node 22 LTS for any tooling/build (avoid 25).

---

## 5. Recommended stack for the NEW coaching app

Per Komplete's stack policy, a portal/app with auth + dashboards + program builder + AI is a **web app**, so:

- **Next.js (latest stable, App Router)** for `coaching.lfgdubai.com`, deployed on Vercel. This is the coaching platform + coach dashboard + client portal.
- **Same Supabase project** (`mqhrjliqjxcxtzorapiy`) — extend the schema with coaching tables (below). One member table, one login, shared with the run/bootcamp side.
- **pgvector** (Supabase extension) for the coaching-brain retrieval.
- **The mobile app:** ship the Next.js PWA first (installable, fast), then wrap with **Capacitor** for a native shell to push through Ahmed's Apple/Google developer accounts. Confirm Ahmed's dev-account access before app phase.
- **Theming as config** (CSS variables / a theme file) so the platform can be re-skinned for other gyms later — protects the reuse-IP model. LFG brand: ink `#0A0A0A`, off-white `#F4F1E9`, olive `#999966`; fonts Barlow Condensed + Barlow (see `design/LFG-DESIGN-PLAYBOOK.md`).

> Note: this introduces Next.js alongside the existing static site. That's fine — the coaching app is a separate deploy on a subdomain, sharing Supabase/Stripe/GHL. Do not rewrite the existing run-club static site.

---

## 6. Modules to build (the six-module model from the pitch)

1. **Coaching programs engine** — 1:1 programs + small-group cohorts; start dates, capacity, per-client plans, progress tracking.
2. **Challenge launcher** — dated 6-week challenges with checkout + rosters (the low-ticket tripwire).
3. **Memberships & payments** — recurring membership (Ahmed's number, ~AED 400/mo) + program payments via Stripe; credit packs already exist.
4. **Accountability** — daily check-in, streaks, progress (weight/photos/measurements/performance), reminders (the LFG app's daily+weekly loop from `ahmed-method/03` and `04`).
5. **CRM sync** — every coaching lead/member/payment → GHL (reuse `api/_ghl.js`).
6. **Owner/coach dashboard** — revenue, active clients, LTV, lapsed-member alerts, monthly report; plus the coach-facing **AI brain** panel.

---

## 7. The AI brain integration (the differentiator)

- Add an API route (e.g. `app/api/coach-brain/route.ts`) that: takes a coach query + optional client context → retrieves relevant chunks from the brain corpus (route via `coaching-brain/INDEX.md` + pgvector similarity) → calls **Claude** with `00_SYSTEM_PROMPT.md` as the system prompt + retrieved chunks + the matching playbook → returns the answer.
- **Ingestion:** chunk the 46 `coaching-brain/*.md` files, embed, store in a `brain_chunks` pgvector table. Keep the markdown as the source of truth; re-embed on update (this is part of the AED 850/mo "updating it").
- **Client context:** pull the client's real record (goals, stats, program, check-ins) from Supabase and pass only what's needed. Keep PII server-side.
- **Model:** default to the latest Claude (see `~/.claude` claude-api skill for current model ids; do not hardcode an old model).
- **Two modes** (already in the system prompt): coach-copilot register + Ahmed's-voice drafts. Ship coach-facing first. A future client-facing mode needs a separate, stricter prompt.
- **Plan generation:** the nutrition-plan builder must output in Ahmed's real template (`ahmed-method/09_nutrition_framework_template.md`), and the workout builder per `playbooks/workout_builder.md`. `LFG-Coaching-Plan-Proof.pdf` is the quality bar.

---

## 8. New data model (additions to Supabase)

Sketch — confirm/refine on build:
- `coaching_clients` (member_id FK, coach_id, program_type, start_date, status, goal, stats snapshot, medical flags).
- `programs` / `cohorts` (name, phase, capacity, dates).
- `client_programs` (client ↔ program, current phase, plan refs).
- `workouts` / `workout_logs` (sessions, exercises, sets/reps, RIR, completed).
- `nutrition_plans` (client, calories, macros, framework doc/json, phase).
- `check_ins` (daily: weight, steps, sleep, stress, mood, cycle; weekly: measurements, photos, form answers).
- `messages` / brain interactions (optional log for the coach panel).
- `brain_chunks` (pgvector embeddings of the corpus).
- Onboarding fields to capture (from `ahmed-method/03_onboarding_protocol.md`): anthropometrics, 3 weekly pillars, wearables, daily habits, nutrition intake, sleep/stress, equipment/access, medical red-flag screen, communication questionnaire, non-negotiables. Screen flags (injury, PCOS, IBS, cycle, postpartum, ED history) drive plan guardrails.

---

## 9. Migration off Kahunas

- Kahunas is Ahmed's current coaching SaaS. Export his existing clients (contacts, programs, history) — get the export from Ahmed.
- Map clients into `members` (dedupe by email/phone against existing LFG members — many overlap with the run club) + `coaching_clients`.
- Preserve active program state so no client loses their place. Plan a cutover date with Ahmed.

---

## 10. Guardrails (carry into the build)

- **Medical/scope:** the brain and platform never diagnose or prescribe clinical care — refer out (already enforced in `00_SYSTEM_PROMPT.md` §5). Keep the disclaimers.
- **Privacy:** real client health data lives server-side, RLS-locked in Supabase; never send more than needed to the model; never expose one client to another.
- **No AI tells in the UI** (Komplete RULE 0): the product must look like a real designed app, not generic AI slop. Use the LFG brand system.
- **Nothing looks like AI in client-facing copy**; keep Ahmed's real voice for anything a client sees.

---

## 11. Open questions to confirm with Loay/Ahmed before/early in build

1. Same Supabase project vs a fresh one for coaching? (Recommended: same, for one login + one CRM.)
2. Ahmed's Apple/Google developer account access + when the app phase starts.
3. Kahunas export format + cutover date.
4. Final membership price (pitch used AED 400/mo) and coaching tier prices (Ahmed sets these).
5. Which of the six modules is MVP for launch vs phase 2 (suggest: programs + check-ins + payments + brain first; challenges/cohorts/dashboard next).
6. Client-facing AI mode now or later? (Recommended: later; coach-copilot first.)

---

## 12. Suggested build order (matches the "2-week / phased" pitch)

**Phase 1 — Coaching core + brain (MVP)**
1. Scaffold Next.js app on `coaching.lfgdubai.com`, Vercel deploy, Supabase auth reusing existing members.
2. Client onboarding flow (the intake fields in §8) + coaching_clients + medical screen.
3. Program + nutrition plan data model; coach can create/assign a plan.
4. Wire the **coaching brain**: ingest corpus → pgvector; `/api/coach-brain` route; coach dashboard panel that generates plans in Ahmed's template (match `LFG-Coaching-Plan-Proof.pdf` quality).
5. Stripe payments for programs; GHL push.

**Phase 2 — Accountability + growth engine**
6. Daily/weekly check-ins, streaks, progress tracking (weight/photos/measurements/performance).
7. Membership billing (recurring) + challenge launcher + cohorts.
8. Owner dashboard (revenue, LTV, lapsed alerts, monthly report).

**Phase 3 — App**
9. PWA polish → Capacitor native wrap → push through Ahmed's store accounts.

**Migration** runs alongside Phase 1→2: export Kahunas, map clients, cutover.

---

## 13. Kickoff prompt for the new chat

> "Building the LFG Coaching Platform. Read `~/Downloads/lfg/LFG-Coaching-Platform-HANDOFF.md` first, then `~/Downloads/lfg/coaching-brain/README.md`, `00_SYSTEM_PROMPT.md` and `INDEX.md`. We're building a Next.js coaching platform on `coaching.lfgdubai.com` that replaces Kahunas, reuses the existing Supabase (`mqhrjliqjxcxtzorapiy`) members/auth/Stripe/GHL, and wires in the coaching brain via pgvector + a `/api/coach-brain` route. Start with Phase 1, step 1: scaffold the Next.js app and confirm Supabase auth reuse. Ask me the open questions in §11 before making irreversible schema decisions."
