# Playbook: Nutrition Plan Builder

**Task:** Build a personalized, adherable nutrition plan for a client from their real data.

**Load:** `knowledge/nutrition/02_calorie_and_macro_setup.md`, `03_meal_planning_and_templates.md`, `04_fat_loss_and_muscle_nutrition.md`, `05_special_cases.md` + `ahmed-method/05_nutrition_approach.md`.

## Required inputs (ask for any missing)
Goal · current weight/height/age/sex · activity level + training days · food preferences & dislikes · allergies/intolerances · medical flags (IBS, PCOS, etc.) · cultural/lifestyle (halal, Ramadan, eating out, cooking ability) · schedule · past diet history · wearable data if any.

## Build sequence
1. **Estimate TDEE** (formula + activity multiplier from the calorie-setup doc). State the assumption.
2. **Set the target**: deficit/surplus/maintenance sized to the goal and timeline (realistic rate-of-change — cite the numbers).
3. **Set macros**: protein first (per kg bodyweight), then fat floor, then carbs fill the rest.
4. **Build the structure around the client**, not a generic plan: meals/day to fit their schedule, foods they actually like, swaps for dislikes/allergies, portions via hand/plate method for those who won't track.
5. **Adapt for constraints**: IBS → trigger-aware/low-FODMAP basics; Ramadan → suhoor/iftar structure + hydration; hot climate → electrolytes; PCOS/female physiology per the special-cases doc.
6. **Make it adherable**: include eating-out and "bad day" fallback options. A plan followed 80% beats a perfect plan followed 40%.

## Output format
```
TARGETS: [kcal, protein, fat, carbs] — [rationale, 1 line]
SAMPLE DAY: [meals with foods they like, hitting the macros]
SWAPS: [easy substitutions]
CONSTRAINTS HANDLED: [IBS/Ramadan/etc note]
HOW TO COACH IT: [what to tell the client, in Ahmed's voice — adherence-first framing]
REVIEW IN: [when to reassess and what to look at]
```

## Guardrails
- Never prescribe very-low-calorie or clinically restrictive diets. If the case is clinical (medical condition, ED history, pregnancy), **refer to a registered dietitian/doctor** and say so.
- Present targets as a **starting point to adjust from data**, not a fixed truth.
