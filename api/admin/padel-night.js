// Admin: run a King of the Court padel night. The write half of /api/padel-board.
//
//   POST { action: 'build_teams' }              -> seed 16 players onto 4 courts, pair round 1
//   POST { action: 'draw_round', round }        -> rotate winners up / losers down, re-pair
//   POST { action: 'score', round, court, a, b }-> save one match's FINAL score
//   POST { action: 'start_round', round }       -> stamp the clock both screens read
//   POST { action: 'reset' }                    -> wipe the night's pairings + matches
//
// THE FORMAT (Ahmed, 2026-08-13 — this replaced the fixed-team version):
//
// 1. PARTNERS ROTATE EVERY ROUND. There is no team for the night, only a pairing
//    for the round, so `padel_teams` is written fresh per round and team_no is
//    scoped to (event_date, round).
//
// 2. WINNERS CLIMB, LOSERS DROP, ONE COURT AT A TIME. Court 1 is The Throne:
//    its winners stay, its losers fall to court 2. Court 4 is the bottom: its
//    losers stay, its winners climb to court 3. Everyone else moves one court in
//    the direction of their result. Each court therefore receives exactly two
//    players from each side and always holds four.
//
// 3. THE PAIR THAT TRAVELS TOGETHER IS SPLIT. "you and ur partner will go up a
//    court but will be against each other." So on arrival the two incoming pairs
//    are cross-matched: X0+Y0 against X1+Y1. Both old partnerships break every
//    single round, which is the whole point of the format.
//
// 4. POINTS ARE INDIVIDUAL AND ONLY WINNERS BANK. "every win = bank your points
//    on scoreboard, every loss = 0 points." Winning 6-3 banks 6 to each winner
//    and 0 to each loser, so a comfortable win is worth more than a scrappy one.
//    Totals are RECOMPUTED from every match rather than incremented, so fixing a
//    typo fixes the standings instead of stacking on top of the mistake.
//
// Every fixture stays editable, so Ahmed can always overrule the draw.
const { requireAdmin, safeError } = require('../_lib');
const { resolveEvent } = require('../padel-status');

const COURTS = 4;
const PER_COURT = 4;

// Points banked by each winner = the games their side won. Losers bank nothing.
function bankedFor(won, gamesWon) { return won ? gamesWon : 0; }

// team_no 1..8 laid out two per court: court 1 holds teams 1 and 2, court 2
// holds 3 and 4, and so on. Keeping it arithmetic means the board never needs a
// lookup table to know which teams share a court.
function teamNosForCourt(court) { return [court * 2 - 1, court * 2]; }
function courtForTeam(teamNo) { return Math.ceil(teamNo / 2); }

// The four players on a court in a given round, as [pairX, pairY].
function pairsOnCourt(teams, court) {
  const [na, nb] = teamNosForCourt(court);
  const a = teams.find((t) => t.team_no === na);
  const b = teams.find((t) => t.team_no === nb);
  return [a, b];
}

// Cross-match two arriving pairs so nobody keeps their partner:
// X = [x0, x1], Y = [y0, y1]  ->  (x0 + y0) against (x1 + y1).
function crossMatch(X, Y) {
  return [
    { player_a: X[0], player_b: Y[0] },
    { player_a: X[1], player_b: Y[1] }
  ];
}

module.exports = async (req, res) => {
  const gate = await requireAdmin(req, res);
  if (!gate) return;
  const { db } = gate;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { data: cfg } = await db.from('event_config')
      .select('padel_datetime, padel_capacity').eq('id', 1).maybeSingle();
    const current = cfg && cfg.padel_datetime ? resolveEvent(cfg.padel_datetime) : null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date || ''))
      ? String(body.event_date)
      : (current && current.ymd);
    if (!date) return res.status(400).json({ error: 'No padel night configured.' });

    // Read-only: lets the scoring page ask "am I allowed to run tonight?" without
    // writing anything. The first version probed with start_round, which stamped
    // a real clock every time the page loaded.
    if (body.action === 'ping') {
      return res.status(200).json({ ok: true, event_date: date });
    }

    if (body.action === 'reset') {
      await db.from('padel_matches').delete().eq('event_date', date);
      await db.from('padel_teams').delete().eq('event_date', date);
      await db.from('padel_night').delete().eq('event_date', date);
      await db.from('padel_signups')
        .update({ points: 0, updated_at: new Date().toISOString() })
        .eq('event_date', date);
      return res.status(200).json({ ok: true, reset: true });
    }

    // ---- Round 1: seed the courts by level -------------------------------
    // Strongest four open on The Throne, next four on court 2, and so on, so the
    // first round is already roughly level-matched and the rotation only has to
    // correct from there. Within a court the four are paired 1+4 against 2+3,
    // the same balancing logic the old snake seed used, now scoped to one court.
    if (body.action === 'build_teams') {
      const { data: signups } = await db.from('padel_signups')
        .select('member_id').eq('event_date', date).eq('paid', true);
      const ids = (signups || []).map((s) => s.member_id);
      if (ids.length < PER_COURT) {
        return res.status(400).json({ error: 'Need at least 4 paid players.' });
      }

      const { data: profiles } = await db.from('padel_profiles')
        .select('member_id, level').in('member_id', ids);
      const levelOf = new Map((profiles || []).map((p) => [p.member_id, Number(p.level) || 1]));
      const ranked = ids.slice().sort((a, b) => (levelOf.get(b) || 1) - (levelOf.get(a) || 1));

      // The format is built for full courts of four. A short night still runs,
      // it just fields fewer courts and the leftovers sit out — better than
      // silently pairing someone with nobody the way the old build could.
      const courts = Math.min(COURTS, Math.floor(ranked.length / PER_COURT));
      const seated = ranked.slice(0, courts * PER_COURT);
      const benched = ranked.length - seated.length;

      const teams = [];
      for (let c = 1; c <= courts; c++) {
        const four = seated.slice((c - 1) * PER_COURT, c * PER_COURT); // strongest first
        const [na, nb] = teamNosForCourt(c);
        teams.push({ team_no: na, player_a: four[0], player_b: four[3] });
        teams.push({ team_no: nb, player_a: four[1], player_b: four[2] });
      }

      await db.from('padel_matches').delete().eq('event_date', date);
      await db.from('padel_teams').delete().eq('event_date', date);
      const { error: insErr } = await db.from('padel_teams')
        .insert(teams.map((t) => ({ ...t, event_date: date, round: 1 })));
      if (insErr) return safeError(res, 'padel-night', insErr, 'Could not build the courts.');

      const fixtures = [];
      for (let c = 1; c <= courts; c++) {
        const [na, nb] = teamNosForCourt(c);
        fixtures.push({ event_date: date, round: 1, court: c, team_a: na, team_b: nb });
      }
      const { error: fErr } = await db.from('padel_matches').insert(fixtures);
      if (fErr) return safeError(res, 'padel-night', fErr, 'Could not draw round 1.');

      await db.from('padel_signups')
        .update({ points: 0, updated_at: new Date().toISOString() })
        .eq('event_date', date);

      await db.from('padel_night').upsert(
        { event_date: date, current_round: 1, round_started_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'event_date' }
      );
      return res.status(200).json({ ok: true, courts, teams: teams.length, benched });
    }

    // ---- Round 2+: rotate on the previous round's results -----------------
    if (body.action === 'draw_round') {
      const round = Math.max(2, Math.round(Number(body.round) || 2));
      const prev = round - 1;

      const [{ data: prevTeams }, { data: prevMatches }] = await Promise.all([
        db.from('padel_teams').select('team_no, player_a, player_b').eq('event_date', date).eq('round', prev),
        db.from('padel_matches').select('court, team_a, team_b, score_a, score_b').eq('event_date', date).eq('round', prev)
      ]);
      if (!prevTeams || !prevTeams.length) {
        return res.status(400).json({ error: 'Build the courts first.' });
      }
      const unplayed = (prevMatches || []).filter((m) => m.score_a == null || m.score_b == null);
      if (unplayed.length) {
        return res.status(400).json({
          error: 'Score every court in round ' + prev + ' before drawing the next one.'
        });
      }

      const courts = (prevMatches || []).length;

      // Winners and losers of each court, as pairs of member ids.
      const winnersOf = new Map(); // court -> [id, id]
      const losersOf = new Map();
      for (const m of prevMatches) {
        const a = prevTeams.find((t) => t.team_no === m.team_a);
        const b = prevTeams.find((t) => t.team_no === m.team_b);
        if (!a || !b) continue;
        const aWon = m.score_a > m.score_b;
        const w = aWon ? a : b;
        const l = aWon ? b : a;
        winnersOf.set(m.court, [w.player_a, w.player_b]);
        losersOf.set(m.court, [l.player_a, l.player_b]);
      }

      // Movement. Court 1 winners hold The Throne, court `courts` losers hold the
      // bottom; everyone else moves exactly one court toward their result.
      const arrivals = new Map(); // court -> { holders: [..], climbers: [..] }
      for (let c = 1; c <= courts; c++) arrivals.set(c, { holders: null, climbers: null });

      for (let c = 1; c <= courts; c++) {
        const w = winnersOf.get(c);
        const l = losersOf.get(c);
        if (!w || !l) continue;
        // Winners: up one court, or stay if already on The Throne.
        const up = c === 1 ? 1 : c - 1;
        // Losers: down one court, or stay if already on the bottom court.
        const down = c === courts ? courts : c + 1;
        if (c === 1) arrivals.get(up).holders = w; else arrivals.get(up).climbers = w;
        if (c === courts) arrivals.get(down).climbers = l; else arrivals.get(down).holders = l;
      }

      const teams = [];
      for (let c = 1; c <= courts; c++) {
        const { holders, climbers } = arrivals.get(c);
        if (!holders || !climbers) {
          return res.status(400).json({ error: 'Court ' + c + ' did not fill. Re-score round ' + prev + '.' });
        }
        const [pairA, pairB] = crossMatch(holders, climbers);
        const [na, nb] = teamNosForCourt(c);
        teams.push({ team_no: na, ...pairA });
        teams.push({ team_no: nb, ...pairB });
      }

      // Re-drawing a round clears its pairings and scores on purpose: a redraw
      // means the fixtures were wrong, and keeping scores against replaced
      // opponents would put fiction on the board.
      await db.from('padel_matches').delete().eq('event_date', date).eq('round', round);
      await db.from('padel_teams').delete().eq('event_date', date).eq('round', round);

      const { error: tErr } = await db.from('padel_teams')
        .insert(teams.map((t) => ({ ...t, event_date: date, round })));
      if (tErr) return safeError(res, 'padel-night', tErr, 'Could not pair the next round.');

      const fixtures = [];
      for (let c = 1; c <= courts; c++) {
        const [na, nb] = teamNosForCourt(c);
        fixtures.push({ event_date: date, round, court: c, team_a: na, team_b: nb });
      }
      const { error: fErr } = await db.from('padel_matches').insert(fixtures);
      if (fErr) return safeError(res, 'padel-night', fErr, 'Could not draw the round.');

      await db.from('padel_night').upsert(
        { event_date: date, current_round: round, round_started_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'event_date' }
      );
      return res.status(200).json({ ok: true, round, fixtures: fixtures.length });
    }

    if (body.action === 'start_round') {
      const round = Math.max(1, Math.round(Number(body.round) || 1));
      await db.from('padel_night').upsert(
        { event_date: date, current_round: round, round_started_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'event_date' }
      );
      return res.status(200).json({ ok: true, round });
    }

    // Call the night. Every score is already saved the moment it is entered,
    // so this saves nothing new: it ENDS the night. Without it the board kept
    // a dead round clock ticking over a finished event and never named a
    // winner, which is what Ahmed hit on 17 Aug after the last round.
    // Reversible on purpose (finished_at back to null), because "we squeezed
    // in one more round" is a normal thing to happen on a padel night.
    if (body.action === 'finish' || body.action === 'unfinish') {
      const done = body.action === 'finish';
      const { data: night } = await db.from('padel_night')
        .select('current_round').eq('event_date', date).maybeSingle();
      if (!night) return res.status(400).json({ error: 'No night to end yet.' });

      if (done) {
        // Calling it with a court still open would freeze a leaderboard that
        // is missing points somebody actually won.
        const { data: open } = await db.from('padel_matches')
          .select('court').eq('event_date', date).eq('round', night.current_round)
          .or('score_a.is.null,score_b.is.null');
        if ((open || []).length) {
          return res.status(400).json({
            error: `Round ${night.current_round} still has ${open.length} court(s) without a score. Score them first, or reset the night.`
          });
        }
      }

      await db.from('padel_night').update({
        finished_at: done ? new Date().toISOString() : null,
        // Stop the countdown. A finished night showing a live clock is the
        // exact confusion this action exists to remove.
        round_started_at: done ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('event_date', date);

      return res.status(200).json({ ok: true, finished: done, round: night.current_round });
    }

    if (body.action === 'score') {
      const round = Math.round(Number(body.round));
      const court = Math.round(Number(body.court));
      const a = body.score_a == null || body.score_a === '' ? null : Math.round(Number(body.score_a));
      const b = body.score_b == null || body.score_b === '' ? null : Math.round(Number(body.score_b));
      if (!Number.isFinite(round) || !Number.isFinite(court)) {
        return res.status(400).json({ error: 'round and court required' });
      }
      // A typo of 60 instead of 6 would distort every total all night, and a
      // negative score is never a real result.
      for (const v of [a, b]) {
        if (v != null && (!Number.isFinite(v) || v < 0 || v > 50)) {
          return res.status(400).json({ error: 'Scores must be between 0 and 50.' });
        }
      }
      // A draw cannot be banked: the format needs a winner to move up.
      if (a != null && b != null && a === b) {
        return res.status(400).json({ error: 'A draw has no winner — King of the Court needs one.' });
      }
      const { error: upErr } = await db.from('padel_matches')
        .update({ score_a: a, score_b: b, played_at: a == null || b == null ? null : new Date().toISOString() })
        .eq('event_date', date).eq('round', round).eq('court', court);
      if (upErr) return safeError(res, 'padel-night', upErr, 'Could not save the score.');

      // Bank each player's points on their signup row, which is what the public
      // padel leaderboard and the community total already read. Recomputed from
      // every round rather than incremented, so a corrected score corrects the
      // totals instead of stacking on top of the mistake.
      const [{ data: allTeams }, { data: allMatches }] = await Promise.all([
        db.from('padel_teams').select('round, team_no, player_a, player_b').eq('event_date', date),
        db.from('padel_matches').select('round, team_a, team_b, score_a, score_b').eq('event_date', date)
      ]);
      const teamKey = (r, n) => r + ':' + n;
      const teamById = new Map((allTeams || []).map((t) => [teamKey(t.round, t.team_no), t]));

      const points = new Map();
      const add = (id, n) => { if (id) points.set(id, (points.get(id) || 0) + n); };
      for (const t of allTeams || []) { add(t.player_a, 0); add(t.player_b, 0); }

      for (const m of allMatches || []) {
        if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) continue;
        const ta = teamById.get(teamKey(m.round, m.team_a));
        const tb = teamById.get(teamKey(m.round, m.team_b));
        if (!ta || !tb) continue;
        const aWon = m.score_a > m.score_b;
        for (const pid of [ta.player_a, ta.player_b]) add(pid, bankedFor(aWon, m.score_a));
        for (const pid of [tb.player_a, tb.player_b]) add(pid, bankedFor(!aWon, m.score_b));
      }

      for (const [pid, pts] of points) {
        await db.from('padel_signups')
          .update({ points: pts, updated_at: new Date().toISOString() })
          .eq('member_id', pid).eq('event_date', date);
      }
      return res.status(200).json({ ok: true, banked: points.size });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return safeError(res, 'padel-night', e, 'Could not update the night.');
  }
};
