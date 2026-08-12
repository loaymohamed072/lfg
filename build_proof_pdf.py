#!/usr/bin/env python3
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                Image, HRFlowable, KeepTogether, PageBreak)

INK=colors.HexColor("#141414"); OLIVE=colors.HexColor("#7A7A52"); OLIVE_D=colors.HexColor("#5E5E3D")
MUT=colors.HexColor("#6b6b64"); LINE=colors.HexColor("#d9d7cc"); PANEL=colors.HexColor("#F4F2EA")
styles=getSampleStyleSheet()
def S(name,**kw):
    kw.setdefault("fontName","Helvetica"); kw.setdefault("textColor",INK)
    kw.setdefault("fontSize",9.5); kw.setdefault("leading",13); kw.setdefault("spaceAfter",4)
    return ParagraphStyle(name,parent=styles["Normal"],**kw)
body=S("body"); small=S("small",fontSize=8,textColor=MUT,leading=11)
h2=S("h2",fontName="Helvetica-Bold",fontSize=14,leading=16,spaceBefore=10,spaceAfter=5)
h3=S("h3",fontName="Helvetica-Bold",fontSize=10.5,textColor=OLIVE_D,leading=13,spaceBefore=7,spaceAfter=2)
kick=S("kick",fontName="Helvetica-Bold",fontSize=8,textColor=OLIVE_D,leading=11,spaceAfter=2)
big=S("big",fontName="Helvetica-Bold",fontSize=20,textColor=OLIVE_D,leading=22)
note=S("note",fontSize=8.5,textColor=MUT,leading=12)
cell=S("cell",fontSize=8.3,leading=10.5,spaceAfter=0)
cellb=S("cellb",fontSize=8.3,leading=10.5,spaceAfter=0,fontName="Helvetica-Bold")
li=S("li",fontSize=9,leading=12.5,leftIndent=9,spaceAfter=2)
def rule(c=OLIVE,w=1.1,sb=2,sa=6): return HRFlowable(width="100%",thickness=w,color=c,spaceBefore=sb,spaceAfter=sa)
def bullets(items,st=li): return [Paragraph("&bull;&nbsp; "+t,st) for t in items]
story=[]

# HEADER
logo="/Users/loay/Downloads/lfg/LFG-Business-Plan/assets/logo.png"
try: im=Image(logo,width=20*mm,height=20*mm)
except Exception: im=Paragraph("LFG",h2)
hdr=Table([[im,Paragraph('LFG COACHING<br/><font size=8 color="#6b6b64">Detailed Plan &middot; Phase 1</font>',h2)]],colWidths=[22*mm,None])
hdr.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),0),("TOPPADDING",(0,0),(-1,-1),0)]))
story+=[hdr,rule(OLIVE,1.4,4,4)]
proof=Table([[Paragraph('<b>What this is.</b> Generated automatically by the <b>LFG Coaching Brain</b> — the AI system built '
 'from Coach Ahmed’s own methods, calls, client plans and certifications, layered on an evidence-based knowledge base. '
 'Produced from a sample intake (Loay) as proof of the system. This is a Phase-1 starting plan, calibrated after a 7-day photo log. '
 'Sources and reasoning are on the final page.',note)]],colWidths=[None])
proof.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PANEL),("BOX",(0,0),(-1,-1),0.6,LINE),
 ("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
story+=[proof,Spacer(1,7)]
story+=[Paragraph("CLIENT",kick),
 Paragraph("<b>Loay</b> &middot; 28 &middot; 184cm &middot; 85kg &middot; trains 6 days/week (gym + running, LFG run club + bootcamp)",body),
 Paragraph("<b>Goal:</b> body recomposition — lose fat, build muscle, look lean. <b>Flags:</b> runner’s knee &middot; very high stress &middot; sleeps 8h.",body)]
story+=[Paragraph("YOUR TARGETS",kick),Paragraph("2,500 kcal / day",big),
 Paragraph("<b>175g Protein &nbsp;&middot;&nbsp; 290g Carbs &nbsp;&middot;&nbsp; 70g Fat.</b> All food weights are cooked unless noted. Macros flex ±10g protein, ±15g carbs/fat; total calories matter most.",body)]

# MEAL PLAN
def dayblock(title,rows,total):
    data=[[Paragraph("Meal",cellb),Paragraph("Food (grams)",cellb),Paragraph("P / F / C",cellb)]]
    for m,f,mac in rows: data.append([Paragraph(m,cellb),Paragraph(f,cell),Paragraph(mac,cell)])
    t=Table(data,colWidths=[20*mm,None,26*mm])
    t.setStyle(TableStyle([("LINEBELOW",(0,0),(-1,0),0.6,OLIVE),("LINEBELOW",(0,1),(-1,-1),0.3,LINE),
     ("VALIGN",(0,0),(-1,-1),"TOP"),("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
     ("LEFTPADDING",(0,0),(0,-1),0),("TEXTCOLOR",(0,1),(0,-1),OLIVE_D)]))
    return KeepTogether([Paragraph(title,h3),t,Paragraph("<b>Day total:</b> "+total,small),Spacer(1,4)])

story+=[Paragraph("PART 1 &nbsp; 7-DAY MEAL PLAN",h2),rule()]
story+=[Paragraph("Order each day: Meal 1 &middot; Protein anchor &middot; Meal 2 (big) &middot; Dinner. You can merge the anchor into Meal 1 to run 2–3 feedings. Swaps by weight: rice ↔ potato ↔ sweet potato ↔ couscous; chicken ↔ turkey ↔ white fish ↔ prawns; sourdough ↔ wrap ↔ oats. Coffee black/splash = free, none after 4pm. 3L water.",small),Spacer(1,4)]

days=[
("DAY 1 — Classic",[
 ("Meal 1","3 whole eggs + 5 egg whites, 80g oats (dry), 1 banana, cinnamon","48 / 20 / 82"),
 ("Anchor","200g Almarai 0% Greek yogurt, 1 tbsp honey, 80g berries","21 / 0 / 31"),
 ("Meal 2","200g chicken breast, 320g basmati rice, 200g grilled veg, 1 tbsp olive oil","74 / 21 / 90"),
 ("Dinner","170g lean beef mince 5%, 250g potato, big salad + lemon, 15g feta","50 / 18 / 45"),
],"≈ 2,510 kcal &middot; 193P &middot; 59F &middot; 248C"),
("DAY 2 — Mediterranean",[
 ("Meal 1","250g Greek yogurt 2%, 60g granola, 30g whey, 1 apple","55 / 12 / 70"),
 ("Anchor","150g cottage cheese, cherry tomatoes, 5 olives","18 / 8 / 6"),
 ("Meal 2","180g salmon, 300g couscous, 200g roasted courgette + pepper, lemon","52 / 26 / 95"),
 ("Dinner","200g shish tawook, 1 wholewheat wrap 60g, fattoush (no fried bread), 1 tbsp olive oil","58 / 22 / 40"),
],"≈ 2,540 kcal &middot; 183P &middot; 68F &middot; 211C"),
("DAY 3 — Asian",[
 ("Meal 1","4 whole eggs, 2 slices sourdough 90g, ½ avocado 75g, chili","32 / 30 / 48"),
 ("Anchor","30g whey in water, 1 banana","26 / 1 / 28"),
 ("Meal 2","180g lean beef strips, 300g jasmine rice, 200g stir-fry veg, 1 tbsp oil, soy","56 / 24 / 90"),
 ("Dinner","200g prawns, 300g cooked rice noodles, pak choi + veg, garlic/ginger, 1 tsp oil","55 / 10 / 78"),
],"≈ 2,560 kcal &middot; 169P &middot; 65F &middot; 244C"),
("DAY 4 — Middle Eastern",[
 ("Meal 1","Shakshuka (4 eggs), 2 slices sourdough 90g","32 / 24 / 52"),
 ("Anchor","200g Greek yogurt 0%, 40g granola","24 / 4 / 32"),
 ("Meal 2","200g chicken thigh (skinless), 300g freekeh/rice, grilled veg, 1 tbsp olive oil","62 / 26 / 88"),
 ("Dinner","170g lean kofta, 100g hummus, 1 pita 60g, tabbouleh (light oil)","52 / 24 / 60"),
],"≈ 2,560 kcal &middot; 170P &middot; 78F &middot; 232C"),
("DAY 5 — Lean & high-carb (hard day)",[
 ("Meal 1","30g whey, 100g oats, 1 banana, 15g peanut butter (blend)","40 / 15 / 90"),
 ("Anchor","2 boiled eggs, 1 apple","13 / 10 / 25"),
 ("Meal 2","220g white fish (hammour/tilapia), 350g rice, 200g veg, 1 tbsp olive oil","60 / 18 / 100"),
 ("Dinner","200g turkey mince, 250g sweet potato, green salad, 15g feta","58 / 16 / 52"),
],"≈ 2,560 kcal &middot; 171P &middot; 59F &middot; 267C"),
("DAY 6 — Comfort (bootcamp day)",[
 ("Meal 1","3 eggs + 4 whites omelette, 250g potato hash, spinach","38 / 22 / 40"),
 ("Anchor","250g Greek yogurt 0%, 80g berries, 1 tbsp honey","25 / 0 / 40"),
 ("Meal 2","180g lean beef, 120g pasta (dry) cooked, tomato-basil, salad, 1 tbsp olive oil","58 / 26 / 92"),
 ("Dinner","200g chicken breast, 200g oven potato wedges (1 tsp oil), grilled veg","64 / 12 / 42"),
],"≈ 2,530 kcal &middot; 185P &middot; 60F &middot; 214C"),
("DAY 7 — Flexible / social",[
 ("Meal 1","200g Greek yogurt, 60g granola, 30g whey, berries","52 / 10 / 60"),
 ("Anchor","30g beef jerky or 150g cottage cheese","20 / 3 / 6"),
 ("Meal 2 (out)","Mixed grill ≈220g (chicken + kofta), ~200g rice, grilled veg, salad","70 / 28 / 70"),
 ("Dinner","180g salmon, large salad, 200g roasted veg, 1 tbsp olive oil","40 / 26 / 20"),
 ("Free window","1 planned treat (2 scoops gelato / a dessert), placed here","5 / 12 / 55"),
],"≈ 2,560 kcal &middot; 187P &middot; 79F &middot; 211C"),
]
for t,r,tot in days: story.append(dayblock(t,r,tot))

# GYM
story+=[PageBreak(),Paragraph("PART 2 &nbsp; FULL GYM PROGRAMME (Phase 1, Weeks 1–4)",h2),rule()]
story+=[Paragraph("4 lifting days + 2 easy runs + 1 rest. Strength sets at <b>2 reps in reserve</b> unless noted. Rest 2–3 min on big lifts, 60–90s on isolation. "
 "<b>Knee rule:</b> pain-free range only, no deep loaded knee bend in Phase 1; the isometrics (Spanish squat / wall sit) reduce knee pain — do them. Log every set.",small)]
week=[["Mon","Day A — Lower (knee-safe)"],["Tue","Day B — Upper Push"],["Wed","Easy run / LFG Run Club (Zone 2)"],
 ["Thu","Day C — Upper Pull"],["Fri","Day D — Full-body / Posterior"],["Sat","Easy 5k or LFG Bootcamp (scale jumps)"],["Sun","Rest — knee prehab + mobility + walk"]]
tw=Table(week,colWidths=[14*mm,None])
tw.setStyle(TableStyle([("FONT",(0,0),(-1,-1),"Helvetica",8.5),("FONT",(0,0),(0,-1),"Helvetica-Bold",8.5),
 ("TEXTCOLOR",(0,0),(0,-1),OLIVE_D),("LINEBELOW",(0,0),(-1,-2),0.3,LINE),("TOPPADDING",(0,0),(-1,-1),3),
 ("BOTTOMPADDING",(0,0),(-1,-1),3),("LEFTPADDING",(0,0),(0,-1),0)]))
story+=[tw,Spacer(1,5)]
def gym(title,rows):
    data=[[Paragraph("Exercise (machine)",cellb),Paragraph("Sets × Reps",cellb),Paragraph("Notes",cellb)]]
    for e,s,n in rows: data.append([Paragraph(e,cell),Paragraph(s,cell),Paragraph(n,cell)])
    t=Table(data,colWidths=[52*mm,24*mm,None])
    t.setStyle(TableStyle([("LINEBELOW",(0,0),(-1,0),0.6,OLIVE),("LINEBELOW",(0,1),(-1,-1),0.3,LINE),
     ("VALIGN",(0,0),(-1,-1),"TOP"),("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),("LEFTPADDING",(0,0),(0,-1),0)]))
    return KeepTogether([Paragraph(title,h3),t,Spacer(1,3)])
story.append(gym("DAY A — LOWER (knee-safe)",[
 ("Leg Press (45° sled)","4 × 10–12","Feet high; stop before deep knee flexion. Quad builder that spares the joint."),
 ("Romanian Deadlift (barbell)","3 × 8–10","Hip hinge, minimal knee bend — hamstrings/glutes."),
 ("Hip Thrust (barbell/machine)","3 × 10–12","1s glute squeeze at top."),
 ("Leg Extension (machine)","3 × 15–20","Light, high-rep, pain-free arc — VMO/knee tracking, not heavy."),
 ("Seated Leg Curl (machine)","3 × 12","3s negative."),
 ("Hip Abduction (machine)","3 × 15","Glute-med — key for runner’s knee."),
 ("Spanish Squat (band) / Wall Sit","3 × 30–45s","Isometric — pain relief + quad strength."),
 ("Standing Calf Raise (machine)","3 × 15",""),
]))
story.append(gym("DAY B — UPPER PUSH",[
 ("Incline DB Press","4 × 8–10","Main chest driver."),
 ("Chest Press (machine, flat)","3 × 10–12","Full squeeze."),
 ("Shoulder Press (machine/DB)","3 × 8–10",""),
 ("Pec Deck (machine)","3 × 12–15","Stretch + squeeze."),
 ("Cable Lateral Raise","3 × 15","Shoulder caps."),
 ("Triceps Rope Pushdown (cable)","3 × 12",""),
 ("Overhead Cable Triceps Ext.","3 × 12","Long-head stretch."),
]))
story.append(gym("DAY C — UPPER PULL",[
 ("Lat Pulldown (machine)","4 × 10–12","Drive elbows down, no swing."),
 ("Chest-Supported Row (machine)","3 × 10","Strict, no lower-back cheat."),
 ("Seated Cable Row (neutral)","3 × 12","Squeeze shoulder blades."),
 ("Reverse Pec Deck (rear delts)","3 × 15","Posture."),
 ("Cable Face Pull","3 × 15","Shoulder health."),
 ("Barbell/EZ Curl","3 × 10",""),
 ("Hammer Curl (DB)","3 × 12","Brachialis/forearm."),
 ("Hanging Knee Raise","3 × 12","Core."),
]))
story.append(gym("DAY D — FULL-BODY / POSTERIOR (knee-friendly)",[
 ("Trap-Bar Deadlift","4 × 6–8","Knee- & back-friendly hinge; main strength lift."),
 ("Incline Machine Press","3 × 10","Upper-body balance."),
 ("Cable Pull-Through","3 × 12","Glutes, zero knee load."),
 ("Step-Ups low box (DBs) / Leg Curl","3 × 10","Only if pain-free, else Glute-Ham/Leg Curl."),
 ("Lat Pulldown / Assisted Pull-up","3 × 10",""),
 ("Cable Crunch","3 × 15",""),
 ("Hip Abduction (machine)","3 × 20","More glute-med."),
]))
story+=[Paragraph("Running, prehab & progression",h3)]
story+=bullets([
 "<b>Running (Wed + Sat):</b> both easy / Zone 2 (talk in full sentences) in Phase 1. No hard intervals until the knee is quiet 2–3 weeks. Increase weekly distance ≤ 10%. ~170–180 cadence, softer landings, avoid downhill pounding.",
 "<b>Knee prehab (Sun + before lower days):</b> Spanish squat 3×45s, wall sit 3×30–45s, band terminal knee extension 3×15, side-lying glute-med 3×15/side, couch stretch 2×30s/side.",
 "<b>Progression (wk 1–3):</b> hit the top of the rep range on all sets at 2 RIR → add ~2.5–5% next session (double progression).",
 "<b>Week 4 deload:</b> same lifts, 2 sets each, ~10% lighter. Then reassess off your logs + week-1 photos and build Phase 2.",
])
story+=[Paragraph("Sharp pain, swelling, or a knee not settling in 2–3 weeks → get it assessed and we deload the running.",small)]

# SOURCES PAGE
story+=[PageBreak(),Paragraph("SOURCES & BASIS — what everything is grounded in",h2),rule()]
story+=[Paragraph("This plan was not invented. Every number and choice comes from one of two places: <b>Coach Ahmed’s own method</b> "
 "(extracted from his real coaching) and a <b>peer-reviewed, evidence-based knowledge base</b>. Here is the basis for each part.",body)]
story+=[Paragraph("The calorie & macro numbers",h3)]
story+=bullets([
 "<b>Maintenance (~2,900–3,000 kcal):</b> Mifflin–St Jeor BMR equation × an activity multiplier for 6 training days — the standard used by NASM and registered dietitians.",
 "<b>Deficit (~2,500 kcal, moderate):</b> a ~15% cut, sized for recomposition while staying fuelled. Basis: Eric Helms (Muscle & Strength Pyramids) and Alan Aragon (Flexible Dieting) — adherence-first, no aggressive cuts.",
 "<b>Protein 175g (~2.0 g/kg):</b> the range that maximises muscle retention in a deficit — ISSN position stand, Helms, Aragon, NASM CNC. Set first as the priority macro.",
 "<b>Fat 70g (~0.85 g/kg):</b> hormone/joint floor. <b>Carbs 290g:</b> fill the remainder to fuel training — standard evidence-based sequencing.",
])
story+=[Paragraph("The training programme",h3)]
story+=bullets([
 "<b>Structure & volume (10–20 hard sets/muscle/week, 2× frequency, progressive overload):</b> Brad Schoenfeld’s hypertrophy research and Eric Helms’ training pyramid (priority order: adherence → volume/intensity/frequency → progression).",
 "<b>Effort (2 RIR) and double progression:</b> autoregulation via RPE/RIR — Helms, Renaissance Periodization (Mike Israetel).",
 "<b>Easy-running emphasis (Zone 2, 80/20):</b> Stephen Seiler’s polarised-training research and Jack Daniels’ Running Formula.",
 "<b>Runner’s-knee approach (strengthen quads/glutes/hips, isometrics, manage load, refer out):</b> sports-physiotherapy consensus for patellofemoral pain, plus Ahmed’s own physio-informed prehab method.",
])
story+=[Paragraph("The coaching approach (the “how”)",h3)]
story+=bullets([
 "<b>“Consistency over intensity,” mind → nutrition → training, the plate method, the 5-of-8 checklist, the 3M framework, the daily/weekly check-in loop:</b> all extracted from Coach Ahmed’s real calls, WhatsApp threads and his own client nutrition frameworks.",
 "<b>Accountability & behaviour change (calendar it, tiny next steps, no-shame lapses, motivation vs discipline):</b> Ahmed’s method, reinforced by Motivational Interviewing (Miller & Rollnick) and habit science (Fogg, Clear).",
 "<b>His credentials:</b> Active IQ Level 3 (personal training + pre/postnatal), which back the screening and refer-out guardrails.",
])
story+=[Paragraph("How the system is built",h3)]
story+=[Paragraph("The brain is a 46-file knowledge system: Ahmed’s method and voice (from his real coaching, all client data removed), a cited knowledge base (training, nutrition, behaviour, assessment), and distilled reference notes from NASM, Precision Nutrition, Helms, Aragon, Schoenfeld and Miller — original synthesis, no copyrighted text reproduced.",body)]
story+=[Paragraph("Honest limits",h3)]
story+=bullets([
 "This is a <b>Phase-1 starting point</b>, not a final plan. The real system calibrates the numbers from a 7-day photo log + body-composition data, exactly as Ahmed does.",
 "The calorie figure is an estimate (no body-fat scan yet). Weekly trends in weight, measurements and gym performance drive the adjustments.",
 "<b>Not medical advice.</b> Injury, illness, disordered eating or clinical nutrition are referred to the appropriate licensed professional.",
])
story+=[Spacer(1,8),rule(LINE,0.6,2,3),
 Paragraph("Generated by the LFG Coaching Brain (AI) &middot; Komplete &times; LFG Dubai &middot; Phase-1 sample &middot; not medical advice",note)]

doc=SimpleDocTemplate("/Users/loay/Downloads/lfg/LFG-Coaching-Plan-Proof.pdf",pagesize=A4,
 leftMargin=15*mm,rightMargin=15*mm,topMargin=13*mm,bottomMargin=11*mm,
 title="LFG Coaching Plan - Detailed (System Proof)",author="LFG Coaching Brain")
doc.build(story)
print("built")
