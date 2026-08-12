# 02 — Calorie & Macro Setup (LFG Coaching Brain)

> **Sources synthesized:** Mifflin-St Jeor (1990) & Katch-McArdle BMR equations, ISSN Position Stands (protein), Eric Helms *Muscle & Strength Pyramid*, Renaissance Periodization / *Renaissance Diet 2.0* (macro allocation), Precision Nutrition (rate-of-change, hand-portion cross-check), Murphy & Koehler 2021 meta-analysis (deficit size vs lean-mass loss), Alan Aragon / Layne Norton (deficit sizing). Original explanations; formulas attributed.

This is the **calculator file.** Given a client's stats and goal, the copilot walks these steps in order and produces calories + protein + fat + carbs. Every number below is a starting estimate to be **adjusted from real-world progress** (Step 6). No formula is the truth; the scale and the mirror are.

---

## STEP 1 — Estimate BMR (Basal Metabolic Rate)

BMR = calories burned at complete rest. Use **Mifflin-St Jeor** by default (most accurate for the general population). Use **Katch-McArdle** only when a *reliable* body-fat % is known (DEXA, good calipers), because it's better for lean/muscular clients.

**Mifflin-St Jeor (default):**
```
Men:   BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) + 5
Women: BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) − 161
```

**Katch-McArdle (if body-fat % known):**
```
LBM_kg = weight_kg × (1 − bodyfat_fraction)
BMR    = 370 + (21.6 × LBM_kg)
```

*Worked BMR — Female, 32 y, 68 kg, 165 cm (our archetypal Dubai client):*
`(10×68) + (6.25×165) − (5×32) − 161 = 680 + 1031.25 − 160 − 161 = ` **≈ 1390 kcal.**

---

## STEP 2 — Estimate TDEE (multiply BMR by an activity factor)

TDEE = BMR × activity multiplier. This is the client's **maintenance calories** — the anchor everything else is set against.

| Multiplier | Activity level | Who it fits |
|---|---|---|
| **1.2** | Sedentary | Desk job, little/no exercise, low daily steps |
| **1.375** | Lightly active | Light exercise 1–3×/week, some walking |
| **1.55** | Moderately active | Moderate exercise/training 3–5×/week (**most LFG clients**) |
| **1.725** | Very active | Hard training 6–7×/week, or active job |
| **1.9** | Extremely active | Physical job + hard daily training |

**House caution:** activity multipliers systematically **overestimate** for desk-bound clients who "train 4×/week" but sit the other 20 hours. When unsure, pick the **lower** multiplier, or use the shortcut below.

**Bodyweight shortcut (fast sanity check, use alongside the formula):**
- Maintenance ≈ **30–33 kcal/kg** for moderately active adults (≈ 14–15 kcal/lb).
- Fat loss ≈ 25–28 kcal/kg. Muscle gain ≈ 33–37 kcal/kg. Use as a cross-check against the Mifflin number.

*Worked TDEE — our 68 kg female at 1.55:* `1390 × 1.55 ≈ ` **2150 kcal maintenance.** (Bodyweight cross-check: 68 × 31 ≈ 2100. Agreement is good → confident anchor ~2100–2150.)

---

## STEP 3 — Set the calorie target for the goal (deficit / surplus / maintenance)

Size the deficit or surplus by **% of bodyweight change per week**, not by a fixed calorie number — this scales correctly across a 55 kg and a 110 kg client. (1 kg body fat ≈ ~7700 kcal.)

### Fat loss — target rate 0.5–1.0% bodyweight/week
Evidence (Murphy & Koehler 2021): **lean-mass loss rises as the deficit grows.** Smaller deficits (~≤500 kcal/day) preserve muscle and even allow slight recomp; deficits driving >1.5%/week roughly double the share of weight lost as muscle. So:

| Deficit size | Rate | Use for |
|---|---|---|
| **Moderate 15–20% below TDEE (≈ 300–500 kcal/day)** ← **house default** | ~0.5–0.75%/wk | Most clients, especially lean-ish or muscle-priority |
| Aggressive 20–25% (≈ 500–750 kcal/day) | ~0.75–1.0%/wk | Higher-body-fat clients, more urgency, good adherence |
| Very aggressive >25% | >1.0%/wk | Rare, short-term, close supervision; expect more muscle & adherence risk |

**Floors — never program below these** (health, hormones, adherence, refer out if lower is "needed"): ~**1200 kcal/day for women, ~1500 kcal/day for men** as a practical lower bound. If the math demands less, the answer is *more activity/steps*, not fewer calories.

### Muscle gain — target rate ~0.25–0.5% bodyweight/week
- **Surplus ~5–15% above TDEE (≈ +200 to +350 kcal/day).** Novices/returning: lower end is plenty. The leaner and more advanced, the slower you must go or it's mostly fat.
- **Lean-gain rule of thumb:** ~+0.25%/wk (≈ +1–2 lb/month) for intermediates, up to ~0.5%/wk for true beginners. Faster than that = excess fat with no extra muscle.

### Maintenance — TDEE ± 0
Eat at estimated TDEE, hold protein, and adjust to keep weight stable across 2–4 weeks. Used between diet phases, during high life-stress periods, for diet breaks, and as the endpoint of a reverse diet.

### Recomp (lose fat + build muscle at once) — maintenance-to-tiny-deficit
Best for: **beginners, returning lifters, higher-body-fat clients, or anyone on a GLP-1.** Set calories at **maintenance to ~10% below (≈ −100 to −250 kcal/day)**, push protein high (2.0–2.4 g/kg), train hard progressively. Slow on the scale, real in the mirror. (More in the fat-loss/muscle file.)

*Worked target — our 68 kg female, fat-loss goal, moderate default:*
Maintenance ~2150 → 18% deficit ≈ −385 kcal → **target ≈ 1750–1800 kcal/day**, projected ~0.55–0.65 kg/week. Above the 1200 floor. Good.

---

## STEP 4 — Set PROTEIN first (the anchor macro)

Protein is fixed to bodyweight, independent of the calorie target (see Principles file). Pick from goal + leanness:

| Goal | Protein | 
|---|---|
| Fat loss while lifting (**default LFG**) | **1.8–2.4 g/kg** |
| Muscle gain | 1.6–2.2 g/kg |
| Maintenance / general | 1.4–1.8 g/kg |
| Higher-body-fat client | base on **goal weight / LBM**, not scale weight |

Convert to calories: **protein = 4 kcal/g.**

*Worked — 68 kg female, fat loss, 2.0 g/kg:* `68 × 2.0 = ` **136 g protein → 544 kcal.**

---

## STEP 5 — Set FAT (floor), then CARBS (fill the rest)

**Fat:** set at **0.5–1.0 g/kg** (never below ~20% of total calories) for hormones, satiety, and vitamin absorption. Fat = **9 kcal/g.**

*Worked — 68 kg × 0.8 g/kg = 54 g fat → 486 kcal.* (Check floor: 486 / 1775 ≈ 27% of calories → healthy, above the 20% floor.)

**Carbs:** whatever calories remain after protein + fat. Carbs = **4 kcal/g.** These are the training-fuel lever (bias toward around-workout).

*Worked — remaining = 1775 − 544 − 486 = 745 kcal → 745 / 4 = ` **≈ 186 g carbs.**

### ✅ Full worked plan — 68 kg female, moderately active, fat loss:
| | kcal | grams |
|---|---|---|
| **Calories** | **~1775** | — |
| Protein (2.0 g/kg) | 544 | **136 g** |
| Fat (0.8 g/kg, 27%) | 486 | **54 g** |
| Carbs (remainder) | 745 | **186 g** |
| Fiber target | — | ~25 g |
| Protein/meal (×4) | — | ~34 g |

---

## STEP 6 — Adjust from real data (the step that actually matters)

Formulas set the **starting point.** The body reveals the truth. Track average weight and adjust every **2–3 weeks** off the *trend*, not daily readings.

**Fat-loss adjustment loop:**
1. Track weekly **average** bodyweight (daily weigh-ins, averaged) + protein adherence + training.
2. Compare 2–3-week trend to the target rate (0.5–1.0%/wk).
3. **Losing on target →** hold, don't touch it.
4. **Not losing after 2–3 wk of good adherence →** cut ~5–10% of calories (≈ 100–200 kcal, usually from carbs/fat, never protein) **or** add ~1000–2000 steps/day (prefer activity first).
5. **Losing too fast / hungry / strength dropping / poor sleep →** add calories back up.
6. **Plateau ≥ 3 wk despite adherence →** consider a diet break at maintenance before cutting further (see fat-loss file).

**Muscle-gain loop:** if gaining faster than ~0.5%/wk (getting soft fast), trim the surplus; if scale/lifts are flat for 2–3 weeks, add ~100–150 kcal (carbs).

**Golden rule:** *the plan is a hypothesis; the trend is the verdict.* Never out-argue the scale with a calculator.

---

## Quick-reference cheat sheet (for fast plan-building)

| Lever | Fast number |
|---|---|
| Maintenance estimate | 30–33 kcal/kg (moderately active) |
| Fat-loss calories | 25–28 kcal/kg (or −15–20% TDEE) |
| Muscle-gain calories | 33–37 kcal/kg (or +5–15% TDEE) |
| Fat-loss rate | 0.5–1.0% BW/week |
| Muscle-gain rate | 0.25–0.5% BW/week |
| Protein (cutting) | 1.8–2.4 g/kg (~0.8–1 g/lb) |
| Protein (gaining) | 1.6–2.2 g/kg |
| Fat | 0.5–1.0 g/kg, ≥20% kcal |
| Carbs | remainder, bias around training |
| Fiber | 14 g / 1000 kcal (~25 F / 30–38 M) |
| Calorie floors | ~1200 F / ~1500 M |
| Macro energy | P 4 · C 4 · F 9 kcal/g |
| Re-adjust cadence | every 2–3 weeks off the trend |
