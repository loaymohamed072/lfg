# Ahmed's Nutrition Framework Template (LFG Coaching)

> **Source note (de-identified):** This template was reverse-engineered from three of Coach Ahmed's real client nutrition frameworks (LFG Coaching). All client names, personal identifiers, contact details, medical specifics tied to an individual, and trip/appointment details have been stripped. What remains is the reusable STRUCTURE, logic, tone, and formatting Ahmed uses so an AI can generate a new client's framework in his exact style. Every `{{PLACEHOLDER}}` is filled per client from their intake, InBody scan, and consultation notes. Nothing here is any one person's plan.

---

## How to use this template

This is a document-generation blueprint. Feed it a client intake (stats, goal, training, cuisine, lifestyle, challenges, any medical notes) and produce a complete, personalized nutrition framework that reads like Ahmed wrote it by hand. The framework is **Phase 1** — an initial calibration plan, not a permanent one. It always ends by asking the client to photo-log meals for 7 days so Ahmed can fine-tune before finalizing.

**Core voice rules (apply throughout):**
- Second person, direct, warm, non-judgmental. Talk *to* the client, not about them.
- Reference the client's own words and habits back to them ("your own go-to breakfast, just built up to hit your numbers", "the 3–4pm crash you described", "your documented main challenge").
- Frame every number with *why it matters for you specifically*. Never present a macro without a reason.
- Consistency over perfection is the through-line. Repeat it. "We do not chase perfection. We chase consistency."
- Deficits are always "moderate and sustainable", never aggressive. Reassure the client they will not be starving.
- Plain language, evidence-informed. No jargon dumps. When science is referenced (PCOS, insulin, celiac, cycle), keep it practical.
- Dubai context is assumed: supermarkets (Spinneys, Waitrose, Carrefour), real brand names, WhatsApp coaching group, LFG app check-ins.
- No shame framing around food slips. "Log it. Enjoy it. Move on." One bad meal never undoes a good week.

---

## Calorie & macro derivation logic (how Ahmed sets the numbers)

Set these BEFORE writing prose, then explain them in Section 1.

1. **Estimate maintenance** from stats + training volume (state it as a range, e.g. "your estimated maintenance of X–Y kcal").
2. **Calories** = maintenance minus a *moderate* deficit for fat-loss / recomp goals (roughly 10–15%, ~200–400 kcal below maintenance). Never an aggressive cut. For an active hybrid/athlete recomp, keep the deficit slight so training is fuelled. State a floor: "do not drop below this when training is active."
3. **Protein** = the priority macro, set first. Roughly **1.7–2.1 g per kg bodyweight** (higher end for recomp/athletic males, ~1.7–1.9 g/kg for female fat-loss/toning). Always framed as "your single most important number… non-negotiable… hit this every day."
4. **Fat** = ~0.7–0.95 g/kg (roughly 25–30% of calories). Framed around hormones, joints, recovery, quality sources.
5. **Carbs** = fill the remaining calories after protein and fat. Framed as training fuel, complex sources, timed around workouts. "Carbs are not the enemy."
6. **Sanity check:** (P×4) + (F×9) + (C×4) should sum to the calorie target within ~50 kcal.
7. **Per-meal split** (used as the target header on each meal section): Breakfast ~25% / Lunch ~35% (the biggest meal) / Dinner ~28% / Snack the remainder. Give each meal a target line: `~XXX kcal | Xg P | Xg F | Xg C`.

---

## Document structure (sections in order)

### COVER / HEADER BLOCK
```
LFG COACHING
NUTRITION FRAMEWORK
{{CLIENT_NAME}}

{{CALORIES}} kcal — Daily Calorie Target
{{PROTEIN}}g Protein   {{CARBS}}g Carbs   {{FAT}}g Fat
```
Then an at-a-glance stats block (label : value):
- **Client** — {{CLIENT_NAME}}
- **Start Date** — {{MONTH_YEAR}}
- **Goal** — {{PRIMARY_GOAL}} (e.g. fat loss + toning; body recomposition + performance; fat loss + event prep)
- **Current Stats** — {{HEIGHT}} | {{WEIGHT}} | {{BODY_FAT_OR_BMI}} (use InBody figures if available: weight, body fat %, BMI)
- **Training** — {{TRAINING_PATTERN}}
- **Cuisine Preferences** — {{CUISINES}} (default lean: Arabic / Middle Eastern, Western / Mediterranean)
- **{{CONDITIONAL_LINE}}** — one of: *Race/Event Goals*, *Target* (weight + timeline), or *Special Notes* (medical: e.g. celiac, PCOS, insulin resistance)
- **Daily Calorie Target** — {{CALORIES}} kcal
- **Protein Target** — {{PROTEIN}}g per day

*(Documents are titled "NUTRITION FRAMEWORK — PHASE 1" and often carry a running footer of `LFG COACHING : {{CLIENT_NAME}} : NUTRITION FRAMEWORK : PHASE 1`.)*

---

### SECTION 1 — UNDERSTANDING YOUR NUTRITION TARGETS
Open: "Your calorie and macro targets have been calculated based on your {{stats / body composition scan}}, {{activity level}}, and your goal of {{goal}}. Here is why each number matters specifically for you:"

Then one short paragraph per number, in this order, each tying the science to *this* client:
- **{{CALORIES}} kcal / day** — "A moderate, sustainable deficit from your estimated maintenance of {{X–Y}} kcal. NOT an aggressive cut." Protects muscle and energy; keeps them fuelled for training. Add the floor rule if athletic.
- **{{PROTEIN}}g Protein** — "Your single most important number", ~{{g/kg}} per kg bodyweight. Preserves lean muscle in a deficit, drives recovery/recomp, keeps them full, stabilises blood sugar (call this out explicitly if PCOS/insulin resistance). "Hit this every day, non-negotiable."
- **{{CARBS}}g Carbs** — fuels training and the workday; "carbs are not the enemy"; prioritise complex carbs (rice, sweet potato, oats, sourdough, quinoa — GF versions if celiac); time highest-carb meals around the training window.
- **{{FAT}}g Fat** — hormone health, joints, skin, vitamin absorption; quality fats (olive oil, eggs, avocado, nuts, salmon); keep fried food / heavy sauces low (name it as where hidden calories hide when eating out).

**"YOUR MAIN CHALLENGES WE ARE ADDRESSING"** — a bullet list built from the consultation, e.g. a documented dietary pitfall (desserts/high-fat food), low daily step count (give a target), the recomp-while-performing tension, event prep, the restart-every-Monday cycle, an afternoon energy crash. Point each challenge to the section that handles it.

**Goal statement:**
- **Short-term ({{~12 weeks}})** — concrete, measurable ({{weight/BF target}}, visible toning, running capacity, confidence for a specific date).
- **Long-term ({{~12 months}})** — the deeper "make fitness permanent / lifestyle, not a phase" framing, using the client's own stated ambition.

**Optional callout box** (⚠️) when the intake shows a history of crash dieting: "Avoid Aggressive Deficits" — name their past restrict-then-binge pattern, promise this plan means they are never starving, invite them to message if hungry ("we adjust"). Tagline: "Consistency at {{CALORIES}} beats perfection at {{lower number}} every single time."

---

### SECTION 2 — 9 MEAL OPTIONS (3 BREAKFAST + 3 LUNCH + 3 DINNER)
Each of the three meal blocks: a **per-meal macro target line**, then **"CHOOSE 1 DAILY"**, then 3 numbered options.

Each option follows a fixed shape:
```
{{n}} {{Meal Name}} ({{prep time}})
•  {{ingredient with quantity}}
•  {{ingredient with quantity}}
•  {{seasoning / optional add}}
Macros: ~{{kcal}} kcal | {{P}}g P | {{F}}g F | {{C}}g C | Prep: {{X}} min
{{one-line personal note}}
```
Rules:
- **Weigh/portion everything** (grams, cups, tbsp). Name the protein weight explicitly (e.g. 150–180g).
- **Use real brands and Dubai availability** where it helps adherence (Almarai Greek yogurt, Puck labneh, Uncle Ben's Express rice, John West tuna, Optimum Nutrition / MyProtein powder, Schär GF products, etc.).
- **Anchor to the client's real habits and cuisine** — build at least one option around a meal they already eat ("your own go-to breakfast, just built up to hit your numbers"; a minced-beef-and-rice bowl; shish tawook; kafta/shakshuka).
- **Personal-constraint notes** drive the design: no office microwave → all lunches eaten cold/room-temp with pack-sauce-separately notes; celiac → every option GF with brand callouts and cross-contamination warnings; no-cook mornings → overnight/jar options.
- Lunch is the biggest meal; dinner is protein-rich and slightly lower-carb ("if you train in the evening, move the higher-carb option to that night").
- Offer swaps within an option (sweet potato ↔ white potato ↔ rice, "same portion by weight").

---

### SECTION 3 — SNACK OPTIONS
Header: "Have 1 snack per day, ideally between lunch and dinner, or as pre-workout fuel on training days." Note the snack's role (prevents the afternoon crash / evening cravings; on a higher calorie budget, "a meaningful part of your daily intake, not an afterthought").

List **~5 options** as a mini-table: `Option | ~kcal | protein (g P) | (optional note)`. Keep them low-prep and grab-able. Always include a high-protein shake option and a rice-cakes-and-nut-butter option.

**Sugar & craving protocol** (always included, escalate wording if desserts are the client's documented pitfall):

**The 3-Step Craving Rule**
1. Drink 500ml water and wait 10 minutes. Most cravings are dehydration or boredom, not true hunger.
2. If still present, eat a protein-first snack from this section. Protein kills sweet cravings faster than willpower.
3. If you genuinely want something sweet: 2 squares dark chocolate (80%+) **or** 2–3 Medjool dates + 1 tsp peanut butter. Portion it, sit down, enjoy it, move on.

Add the "protein/fat alongside any sweet food blunts the blood-sugar spike" line. If desserts are a main challenge, add **High-Fat Junk Food Rules**: one *planned* window per week (a meal, not a day), placed on a hard training day; never eat junk on an empty stomach (protein-first main meal before any social eating); log it on the WhatsApp group — "no shame, no hiding… awareness, not punishment."

---

### SECTION 4 — GRAB & GO GUIDE (DUBAI SUPERMARKETS)
Intro: "Screenshot this page and keep it on your phone. All items below are available at Spinneys, Waitrose, or Carrefour." (If celiac: "These are all confirmed gluten-free items.")

Four labelled categories, real brands, with store tags in brackets:
- **Protein Sources** — tuna (John West spring water / Albacore pouches), rotisserie chicken (plain only), pre-packed boiled eggs, Almarai Greek yogurt, Puck labneh, Arla cottage cheese, natural peanut/almond butter (nuts + salt only), fresh salmon.
- **Carbohydrates & Staples** — Uncle Ben's Express rice pouches, Royal basmati/jasmine bulk, sweet potatoes, Quaker oats (certified-GF alternative if celiac), sourdough/wholegrain, wraps/tortillas (GF brand if celiac), quinoa.
- **Snacks & On-the-Go** — RXBAR, KIND bars (check label), portioned nuts (20–30g), Medjool dates (2–3 max, pre-workout), individual Greek yogurt cups, hummus pots, plain rice cakes.
- **Frozen & Emergency Meals** — Amy's Kitchen bowls (check sodium), plain marinated chicken skewers, frozen stir-fry veg, edamame, GF pasta pouches (if celiac).

Add condition-specific callouts inline (e.g. celiac: "Regular Quaker oats are NOT safe — cross-contamination risk; buy certified-GF oats only").

---

### SECTION 5 — EATING OUT, SOCIAL GATHERINGS & BUFFETS
Frame it as part of the client's real life, not the exception ("You go out with friends regularly… this is part of your lifestyle").

**The Plate-Building Method** (5 steps, fixed):
1. **Protein First** — fill HALF the plate with the clearest protein (grilled chicken, fish, eggs, plain beef/kofta). Avoid heavy cream/oil sauces.
2. **Vegetables** — fill a QUARTER (salads, roasted/grilled veg). Dress with olive oil + lemon only.
3. **Carbs** — fill the remaining QUARTER (plain rice, potatoes, one flatbread). Avoid heavy pasta, pilaf/mandi with extra oil, fried rice.
4. **One Plate Rule** — wait 10 minutes before going back. Still hungry? Return for protein and veg only, no extra carbs.
5. **Eat Before You Arrive** — never show up starving. Have a snack or protein source 30–45 min before; you make far better choices.

**Restaurant Type Rankings** — a BEST / GREAT / GOOD / MANAGE (/ MOST CAUTION) tier list mapped to cuisines, with a one-line strategy each. Default anchor: BEST = Middle Eastern grill (mandi, mashawi, shish tawook, kafta). Adapt tiers to the client's actual haunts (healthy-bowl spots, weddings, conference buffets).

**Buffet / event survival hacks** — Eat before; Scope the whole buffet before plating; Skip/relocate the bread basket; Carry a backup (bar + nuts); One Dessert Rule at dessert-heavy events. Adapt the scenario to the client (weddings, conferences, FIFA/shisha nights). For no-food hangouts (coffee, shisha): "free pass, enjoy it." Suggest 1 low-structure social night per week on their rest day.

**Celiac add-on** (only if relevant): the medical framing script — *"I have Celiac Disease, not just a preference"* triggers kitchens to take cross-contamination seriously. List hidden-gluten traps, usually-safe foods, and questions to ask the waiter.

---

### CONDITIONAL SECTION — SPECIAL STRATEGY (insert only if the intake warrants it)
Pick and build the ones that apply, each as its own titled block with practical non-negotiables:
- **PCOS & Insulin Resistance** — never skip breakfast (eat within 1 hr of waking); protein with every meal, never carbs alone; limit processed sugar with named swaps; anti-inflammatory foods; avoid seed oils; period-week adaptation. Optional supplement note (magnesium glycinate, omega-3) framed as "ask your doctor."
- **Energy / Consistency Strategy** — for the restart-every-Monday client: non-negotiables (never skip breakfast, protein every meal, eat every 3–4 hrs, hydrate, raise daily steps with a concrete target); cycle-week adaptation (drop intensity days 1–2, add 100–150 kcal mostly carbs if low, don't skip meals); "Breaking the Monday Restart Cycle" reassurance; Vitamin D note (common deficiency in Dubai).
- **Cycle-Week Adaptation** — reduce intensity first 1–2 days, add 100–150 kcal (mostly carbs), magnesium-rich foods, do not skip meals; track how you feel each phase in the check-in.
- **Event / Race Nutrition** — carb-load in the lead-up week (+50–80 g/day), reduce training volume, biggest carb meal the night before; keep it simple and low-stress for travel.
- **Medical-flag protocol** — e.g. accidental gluten: increase water to 3L, plain rice + plain protein + plain veg for 24–48 hrs, tell Ahmed.

---

### DAILY CHECKLIST & NEXT STEPS
"Complete this mentally (or on the app) every evening." Present **8 checkboxes as questions** (the exact set flexes with the client's priorities):
- ☐ Protein target hit — "Did I get at least {{PROTEIN}}g protein today?"
- ☐ Stayed within {{CALORIES}} kcal — "…within target (±100 kcal is fine)?"
- ☐ Ate breakfast (within 1 hour of waking) — if relevant
- ☐ Protein with every meal
- ☐ Water intake — "at least {{2–2.5}}L?"
- ☐ Steps target — "at least {{N}} steps?"
- ☐ Condition/goal box — e.g. no gluten consumed / no unplanned junk / workout done or planned / 3 meals + 1 snack
- ☐ Logged meals or photos for the WhatsApp group

**Weekly Win Benchmark:** "5 out of 8 checkboxes, every day, for 7 days = a winning week. We do not chase perfection. We chase consistency. Ahmed reviews your weekly check-in every Monday."

---

### IMPORTANT NOTES & NEXT STEPS
Label : instruction format:
- **Week 1 Task** — post photos of every meal in the WhatsApp coaching group for 7 days "so Ahmed can see your real eating patterns and calibrate before finalising your permanent plan." (This is what makes it Phase 1.)
- **Macro Flexibility** — "You do not need to hit macros exactly. Within ±10g protein and ±15g carbs/fat is fine. Total daily calories matter most."
- **Meal Prep Day** — cook proteins and rice in bulk once a week (name the day) to "eliminate weekday decision fatigue."
- **{{Condition/goal-specific notes}}** — race nutrition, equipment check for program build, trip planning, appointment scheduling, gluten-reaction protocol, etc.
- **Check-In Schedule** — "Every Sunday morning: weigh yourself, take measurements, submit your weekly check-in on the LFG app. Ahmed reviews every Monday."

**Closing (verbatim style):**
> You have everything you need. Now execute.
> Questions? WhatsApp Ahmed or Omar anytime. LFG.

---

## One-glance generation checklist
- [ ] Numbers derived (maintenance → moderate deficit → protein by bodyweight → fat → carbs fill remainder; macro sum checks out)
- [ ] Every macro explained with a *why-for-you*
- [ ] 9 meals + ~5 snacks, portioned, real brands, at least one built on the client's own habits, constraints respected (microwave, GF, no-cook)
- [ ] Craving protocol + (if needed) junk-food rules
- [ ] Dubai grab-and-go guide
- [ ] Plate-building method + restaurant tiers + buffet hacks, scenario matched to the client
- [ ] Conditional special-strategy block(s) only where warranted
- [ ] 8-box daily checklist, 5/8 weekly-win benchmark
- [ ] Phase 1 framing: Week-1 photo log, macro flexibility, prep day, Sunday check-in
- [ ] Tone: direct, warm, no shame, consistency-over-perfection, ends "Now execute. LFG."
