# LFG Coaching Brain

A private coaching intelligence for **LFG Coaching (Coach Ahmed Sam)**. It is a copilot for the coach: it summarizes clients, recommends the best next move, builds nutrition plans and workouts, advises on handling clients, and helps with pricing and deals, all in Ahmed's method and voice.

Built from two things: **Ahmed's real coaching method and voice**, extracted from his own calls and client chats, and a **researched, evidence-based knowledge base** covering training, nutrition, behaviour change, coaching psychology, and assessment.

---

## What it is for

Primary user: **Ahmed / the LFG coaches** (coach-facing copilot).

It answers tasks like:
- "Summarize this client and tell me the best next move."
- "Build a 12-week plan for a female client, half-marathon + fat loss, knee history, 4 days/week."
- "Write me a nutrition plan for a client with IBS who does Ramadan."
- "This client has gone quiet for two weeks, what do I send?"
- "What should I charge this lead and how do I frame the offer?"

It is **not** a replacement for Ahmed's judgment or for medical advice. It flags when to defer to a doctor, dietitian, or physiotherapist.

---

## Architecture

```
coaching-brain/
  README.md                 ← this file
  00_SYSTEM_PROMPT.md        ← master persona + operating rules (the "brain" prompt)
  INDEX.md                   ← retrieval index for the website (what to load when)

  ahmed-method/              ← HOW AHMED COACHES (from his own calls + chats, PII-stripped)
    01_philosophy_and_method.md
    02_discovery_and_consultation.md
    03_onboarding_protocol.md
    04_programming_approach.md
    05_nutrition_approach.md
    06_voice_and_communication.md
    07_client_handling_and_retention.md
    08_sales_and_deals.md

  knowledge/                 ← WHAT THE BRAIN KNOWS (researched, evidence-based, cited)
    training/                ← program design, hypertrophy/strength, fat loss, running, HYROX, special populations
    nutrition/               ← principles, calorie/macro setup, meal planning, fat loss/muscle, special cases, supplements
    behavior-coaching/       ← behaviour change, motivational interviewing, adherence/retention, situations, communication
    assessment/              ← intake/screening, progress tracking

  playbooks/                 ← TASK RECIPES the copilot runs
    client_summary.md
    next_best_move.md
    nutrition_plan_builder.md
    workout_builder.md
    client_situation_handler.md
    deal_advisor.md
```

**How the pieces combine:** `00_SYSTEM_PROMPT.md` sets the persona (Ahmed's method + voice as the operating layer). For any task, the copilot loads the matching **playbook**, pulls the relevant **knowledge/** and **ahmed-method/** docs (see `INDEX.md`), and produces an answer in Ahmed's voice.

---

## Implementing it in the LFG website

The LFG platform is static HTML + Vercel serverless functions + Supabase. To wire the brain in:

1. **Store the corpus.** Keep these markdown files as the knowledge source. For retrieval, chunk them and embed into a vector store (Supabase `pgvector` works with the existing Supabase project).
2. **Add an API endpoint.** A new serverless function (e.g. `api/coach-brain.js`) that takes a coach query + optional client context, retrieves the top relevant chunks via `INDEX.md` routing + vector search, and calls an LLM (Claude) with `00_SYSTEM_PROMPT.md` as the system prompt plus the retrieved chunks and the chosen playbook.
3. **Feed client context.** Pull the client's real data (goals, measurements, program, check-ins) from the existing Supabase tables so answers are personalized. Keep PII server-side; never send more than needed to the model.
4. **Coach UI.** A simple chat panel in the admin area. Optionally expose the playbooks as one-click actions ("Summarize client", "Build plan", "Draft check-in").

Keep the brain **private**: it is a coach tool. A future client-facing mode would need a separate, safer prompt (no pricing/strategy, tighter medical guardrails).

---

## Provenance & rules

- **Ahmed's method** is extracted from his real transcripts, with all client PII removed. It captures patterns, not individuals.
- **The knowledge base** is original synthesis grounded in cited, evidence-based sources (named in each file). No copyrighted course/book text is reproduced.
- **Safety:** the brain always defers clinical questions (injury, illness, disordered eating, clinical nutrition) to the appropriate professional. See guardrails in `00_SYSTEM_PROMPT.md`.
