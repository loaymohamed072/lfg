# LFG Platform — Product Direction (locked decisions)

**Date:** 2026-07-03. Agreed by Loay. Supplements `LFG-Coaching-Platform-HANDOFF.md` and `KAHUNAS-TEARDOWN.md`. The build chat should treat these as decided.

## 1. Core thesis

Ahmed's bottleneck is manual hours per client (reading raw check-ins, writing every plan, retyping advice). He is capped in the 30s-client range because time scales linearly with clients. The platform's job is to remove him from every loop that doesn't need his judgment, so the same hours hold 100+ clients. Not a prettier Kahunas: a throughput machine.

## 2. Locked decisions

1. **In-platform chat is the backbone, not WhatsApp.** One timeline per client: messages, check-ins, plan changes, photos, payments in a single connected thread. Coaching conversations happen in-app. WhatsApp is demoted to a notification/nudge channel (deep-links back into the app) because UAE clients live there; do not cold-kill it. Phase 2: move the "private coaching group" (sold in every package) in-app.
2. **AI is coach-side ONLY and invisible to clients.** All brain calls server-side; outputs render only in the coach dashboard. No client-facing AI labels, summaries, or tells, ever. Every AI output passes through Ahmed's approve/edit step and ships as Ahmed, in his voice. (Matches handoff §7 two-modes note and §10 guardrails.)
3. **"One click, everything ready" is the main product point.** Ahmed reviews finished drafts; he never starts from blank builders.

## 3. The 10x mechanics (build these, in this order of leverage)

1. **Daily triage queue** (replaces the Kahunas dashboard-as-feed). Ranked queue of check-ins/events, red flags first. Each item arrives pre-analyzed: trends computed, brain summary, reply drafted in Ahmed's voice, suggested plan tweaks. Approve/edit → one click → next. Target: 20 min/check-in → 2 min.
2. **Self-running onboarding.** Link → consent → Stripe → Q&A (Ahmed's exact intake, see teardown §2.10). On Q&A submit, the brain auto-drafts the full workout program + nutrition plan in Ahmed's real templates (`ahmed-method/09`, quality bar = `LFG-Coaching-Plan-Proof.pdf`). Paid → programmed in minutes, pending Ahmed's approval.
3. **Client brief everywhere.** Beside any client thread: who they are, goal, phase, last 3 check-ins, what's slipping, suggested next move (playbooks `client_summary` + `next_best_move`).
4. **Watchdog flags.** Plateau detection, missed check-ins, rapid weight changes, medical guardrails from intake screens (injury, PCOS, IBS, cycle, postpartum, ED history) surface automatically in the queue.
5. **Reusable sends.** Broadcasts, education drops, renewal nudges pre-drafted from templates.

## 4. Improvement loop ("better throughout the way")

- Corpus is markdown → update + re-embed continuously (covered by the AED 850/mo retainer).
- Store Ahmed's edits to AI drafts as voice/style examples; drafts converge on his voice, editing time drops monthly.
- Client-side engagement compounds: streaks + one thread + fast replies → higher check-in compliance → better data → better drafts.

## 5. Non-negotiables carried forward

- Feature parity checklist in `KAHUNAS-TEARDOWN.md` §4 gates cutover.
- No AI tells anywhere in client-facing UI or copy (Komplete RULE 0 + handoff §10).
- Client PII server-side, RLS-locked; send the model only what a task needs.
