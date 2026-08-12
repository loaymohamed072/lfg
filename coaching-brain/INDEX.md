# INDEX — Retrieval Map

How the website/RAG layer decides what to load for a given coach query. Always load `00_SYSTEM_PROMPT.md` as the system message. Then load the matching **playbook** and the **knowledge/method** files below. When in doubt, prefer fewer, more relevant files over dumping everything.

---

## Route by intent

| Coach query looks like… | Load playbook | + method | + knowledge |
|---|---|---|---|
| "Summarize this client / brief me before the call" | `playbooks/client_summary.md` | `ahmed-method/03_onboarding_protocol.md` | `knowledge/assessment/02_progress_tracking.md` |
| "What should I do with X / best next move" | `playbooks/next_best_move.md` | `ahmed-method/07_client_handling_and_retention.md` | `knowledge/behavior-coaching/04_client_situations_playbook.md`, `03_adherence_and_retention.md` |
| "Build / fix a nutrition plan" | `playbooks/nutrition_plan_builder.md` | `ahmed-method/05_nutrition_approach.md` | `knowledge/nutrition/02`, `03`, `04`, and `05` if special case |
| "Build / fix a workout or program" | `playbooks/workout_builder.md` | `ahmed-method/04_programming_approach.md` | `knowledge/training/02` + the goal file (`03`–`06`), `07` if injury/population |
| "Draft a message / handle a situation" | `playbooks/client_situation_handler.md` | `ahmed-method/06_voice_and_communication.md`, `07_client_handling_and_retention.md` | `knowledge/behavior-coaching/02_motivational_interviewing.md`, `05_communication_and_difficult_conversations.md` |
| "What to charge / offer / renewal" | `playbooks/deal_advisor.md` | `ahmed-method/08_sales_and_deals.md`, `02_discovery_and_consultation.md` | `knowledge/behavior-coaching/03_adherence_and_retention.md` |
| "New client intake / screening" | `playbooks/client_summary.md` | `ahmed-method/03_onboarding_protocol.md` | `knowledge/assessment/01_assessment_and_intake.md` |

**Always available as persona context** (load or keep embedded for every call): `ahmed-method/01_philosophy_and_method.md`. It sets how Ahmed reasons and is the tie-breaker for any ambiguity.

---

## Route by topic (for retrieval / embeddings)

- **Training** → `knowledge/training/` : principles(01), program design(02), hypertrophy/strength(03), fat-loss/recomp(04), running/endurance(05), HYROX/hybrid(06), special populations & injuries(07).
- **Nutrition** → `knowledge/nutrition/` : principles(01), calorie/macro setup(02), meal planning/templates(03), fat-loss/muscle(04), special cases incl. IBS/PCOS/Ramadan/hot-climate(05), supplements(06).
- **Behaviour & coaching** → `knowledge/behavior-coaching/` : behaviour change(01), motivational interviewing(02), adherence/retention(03), client situations(04), communication & hard conversations(05).
- **Assessment** → `knowledge/assessment/` : intake/screening(01), progress tracking(02).
- **Ahmed's method & voice** → `ahmed-method/` : philosophy(01), discovery/consultation(02), onboarding(03), programming(04), nutrition approach(05), voice(06), client handling/retention(07), sales/deals(08), **his nutrition-framework template(09)**, **his credentialed method/certifications(10)**.
- **Women's health add-on** → `knowledge/training/08_pelvic_floor_womens_health.md` (screen + refer; postpartum/menopause).

### Deepening sources → `knowledge/_book-notes/`
Distilled, attributed principle-summaries from the reference library. Pull the matching note when a task needs more depth than the core files, or when the coach asks for the "book-level" answer.
- `aragon_flexible_dieting.md` — flexible dieting / IIFYM done right → deepens nutrition.
- `nasm_cnc.md` — NASM Certified Nutrition Coach model → deepens nutrition + behaviour-coaching.
- `helms_strength_pyramid.md` — training-variable priority pyramid → deepens training.
- `schoenfeld_hypertrophy.md` — muscle-growth science → deepens training/hypertrophy.
- `miller_motivational_interviewing.md` — MI for coaches → deepens behaviour-coaching (MI).
- `coaching_habit.md` — the seven coaching questions → deepens behaviour-coaching + Ahmed's discovery/check-ins.

**How to use book-notes:** they are supporting depth, not the operating layer. Ahmed's method and the core knowledge files lead; a book-note is loaded when the coach wants the evidence/detail behind a recommendation. `ahmed-method/09` and `10` are Ahmed's own real template and credentials — treat them as first-class method, not just reference.

---

## Retrieval rules

1. **System prompt + philosophy always.** Everything else is task-scoped.
2. **Method sets tone and framing; knowledge sets the science.** For any plan, combine both: build it on the evidence base, deliver it in Ahmed's method and voice.
3. **Special cases override defaults.** If the client has IBS, PCOS, is in Ramadan, pregnant/postpartum, injured, or has an ED history, always pull the relevant special-case/injury file and apply its guardrails.
4. **Escalate to guardrails.** Any clinical/medical/mental-health signal → surface the referral guardrail from `00_SYSTEM_PROMPT.md` §5 regardless of topic.
5. **Client data is separate.** The live client record (from Supabase) is passed in per request; keep it server-side and out of the embedded corpus.
