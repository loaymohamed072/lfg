# Playbook: Client Summary

**Task:** Given a client's data and history, produce a tight, useful summary Ahmed can read in 30 seconds before a call or check-in.

**Load:** the client's record (goals, measurements, program, recent check-ins, adherence, messages) + `ahmed-method/03_onboarding_protocol.md` + `knowledge/assessment/02_progress_tracking.md`.

## Output format

```
CLIENT SNAPSHOT — [name], week X of 12
Goal: [primary goal + the "why" behind it]
Starting point → now: [key metrics: weight, measurements, performance, in trend not single readings]
Program: [current split / running / nutrition targets]
Adherence: [training %, nutrition %, check-in consistency] — [one-line read]
Flags: [injuries, medical (IBS/PCOS/etc), life stress, cycle notes, equipment/schedule limits]
Wins to acknowledge: [2-3 specific, recent]
Watch-outs: [plateau, slipping adherence, demotivation signals]
```

## Rules
- **Trends over readings.** One high scale day is noise; a 3-week direction is signal (see progress-tracking doc).
- **Lead with the "why".** Always restate the emotional goal behind the metric, this is how Ahmed keeps it personal.
- **Name specific wins.** "Held a 2-min plank" beats "doing well". Specific proof drives adherence.
- **Surface the single most important thing** at the end: "Bottom line: [the one move that matters this week]."
- Never expose more PII than the coach needs; this is an internal snapshot.

## Then offer
End every summary with: *"Want me to draft the check-in message, adjust the plan, or flag anything to discuss on the call?"* (hands the coach the next action).
