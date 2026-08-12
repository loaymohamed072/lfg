// Admin: run a King of the Court padel night. The write half of /api/padel-board.
//
//   POST { action: 'build_teams' }              -> pair the paid players into 8 teams
//   POST { action: 'draw_round', round }        -> seed a round's 4 court fixtures
//   POST { action: 'score', round, court, a, b }-> save one match's FINAL score
//   POST { action: 'start_round', round }       -> stamp the clock both screens read
//   POST { action: 'reset' }                    -> wipe the night's teams + matches
//
// Two rules carry the format:
//
// 1. TEAMS ARE SNAKE-SEEDED by the skill level the roster already tracks
//    (1-8, 2-7, 3-6, 4-5). Pairing the two best players together produces one
//    unbeatable team and seven pointless matches; snake seeding makes every
//    team's combined level near-identical, which is the whole point of a level
//    system nobody would otherwise use.
//
// 2. ROUND 2+ IS DRAWN FROM THE STANDINGS, which is what "King of the Court"
//    means here: re-rank after every round, then play 1v2 on Court 1 (The
//    Throne), 3v4 on Court 2, and so on. Winners climb toward the Throne and
//    losers fall away from it without anyone tracking who moves where by hand.
//    Every fixture stays editable, so Ahmed can always overrule the draw.
const { requireAdmin, safeError } = require('../_lib');
const { resolveEvent } = require('../padel-status');

const COURTS = 4;
const WIN_POINTS = 3;

function standings(teamNos, matches) {
  const table = new Map(teamNos.map((n) => [n, { team_no: n, points: 0, wins: 0, gf: 0, ga: 0 }]));
  for (const m of matches) {
    if (m.score_a == null || m.score_b == null) continue;
    const a = table.get(m.team_a), b = table.get(m.team_b);
    if (!a || !b) continue;
    a.gf += m.score_a; a.ga += m.score_b;
    b.gf += m.score_b; b.ga += m.score_a;
    if (m.score_a > m.score_b) { a.wins++; a.points += WIN_POINTS; }
    else if (m.score_b > m.score_a) { b.wins++; b.points += WIN_POINTS; }
  }
  return [...table.values()].sort((x, y) =>
    y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team_no - y.team_no
  );
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
      return res.status(200).json({ ok: true, reset: true });
    }

    if (body.action === 'build_teams') {
      const { data: signups } = await db.from('padel_signups')
        .select('member_id').eq('event_date', date).eq('paid', true);
      const ids = (signups || []).map((s) => s.member_id);
      if (ids.length < 4) return res.status(400).json({ error: 'Need at least 4 paid players.' });

      const { data: profiles } = await db.from('padel_profiles')
        .select('member_id, level').in('member_id', ids);
      const levelOf = new Map((profiles || []).map((p) => [p.member_id, Number(p.level) || 1]));
      const ranked = ids.slice().sort((a, b) => (levelOf.get(b) || 1) - (levelOf.get(a) || 1));

      // Snake seed: strongest with weakest, so every team's combined level is
      // within a fraction of every other team's.
      const teams = [];
      let lo = 0, hi = ranked.length - 1, no = 1;
      while (lo < hi) { teams.push({ team_no: no++, player_a: ranked[lo++], player_b: ranked[hi--] }); }
      if (lo === hi) teams.push({ team_no: no++, player_a: ranked[lo], player_b: null });

      await db.from('padel_matches').delete().eq('event_date', date);
      await db.from('padel_teams').delete().eq('event_date', date);
      const { error: insErr } = await db.from('padel_teams')
        .insert(teams.map((t) => ({ ...t, event_date: date })));
      if (insErr) return safeError(res, 'padel-night', insErr, 'Could not build the teams.');

      await db.from('padel_night').upsert(
        { event_date: date, current_round: 1, round_started_at: null, updated_at: new Date().toISOString() },
        { onConflict: 'event_date' }
      );
      return res.status(200).json({ ok: true, teams: teams.length });
    }

    if (body.action === 'draw_round') {
      const round = Math.max(1, Math.round(Number(body.round) || 1));
      const { data: teams } = await db.from('padel_teams')
        .select('team_no').eq('event_date', date).order('team_no');
      const teamNos = (teams || []).map((t) => t.team_no);
      if (teamNos.length < 2) return res.status(400).json({ error: 'Build the teams first.' });

      // Round 1 plays the seeding order; every later round plays the table, so
      // the Throne is always contested by the two teams actually leading.
      let order = teamNos;
      if (round > 1) {
        const { data: played } = await db.from('padel_matches')
          .select('round, team_a, team_b, score_a, score_b')
          .eq('event_date', date).lt('round', round);
        order = standings(teamNos, played || []).map((s) => s.team_no);
      }

      const fixtures = [];
      for (let i = 0; i + 1 < order.length && fixtures.length < COURTS; i += 2) {
        fixtures.push({
          event_date: date,
          round,
          court: fixtures.length + 1,
          team_a: order[i],
          team_b: order[i + 1]
        });
      }
      // Re-drawing a round clears its scores on purpose: a redraw means the
      // fixtures were wrong, and keeping scores against replaced opponents
      // would put fiction on the board.
      await db.from('padel_matches').delete().eq('event_date', date).eq('round', round);
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

    if (body.action === 'score') {
      const round = Math.round(Number(body.round));
      const court = Math.round(Number(body.court));
      const a = body.score_a == null || body.score_a === '' ? null : Math.round(Number(body.score_a));
      const b = body.score_b == null || body.score_b === '' ? null : Math.round(Number(body.score_b));
      if (!Number.isFinite(round) || !Number.isFinite(court)) {
        return res.status(400).json({ error: 'round and court required' });
      }
      // A typo of 60 instead of 6 would distort the tiebreak all night, and a
      // negative score is never a real result.
      for (const v of [a, b]) {
        if (v != null && (!Number.isFinite(v) || v < 0 || v > 50)) {
          return res.status(400).json({ error: 'Scores must be between 0 and 50.' });
        }
      }
      const { error: upErr } = await db.from('padel_matches')
        .update({ score_a: a, score_b: b, played_at: a == null || b == null ? null : new Date().toISOString() })
        .eq('event_date', date).eq('round', round).eq('court', court);
      if (upErr) return safeError(res, 'padel-night', upErr, 'Could not save the score.');

      // Bank each player's points on their signup row, which is what the public
      // padel leaderboard and the community total already read. Recomputed from
      // every match rather than incremented, so a corrected score corrects the
      // totals instead of stacking on top of the mistake.
      const [{ data: allTeams }, { data: allMatches }] = await Promise.all([
        db.from('padel_teams').select('team_no, player_a, player_b').eq('event_date', date),
        db.from('padel_matches').select('team_a, team_b, score_a, score_b').eq('event_date', date)
      ]);
      const table = standings((allTeams || []).map((t) => t.team_no), allMatches || []);
      const pointsByTeam = new Map(table.map((t) => [t.team_no, t.points]));
      for (const t of allTeams || []) {
        const pts = pointsByTeam.get(t.team_no) || 0;
        for (const pid of [t.player_a, t.player_b]) {
          if (!pid) continue;
          await db.from('padel_signups')
            .update({ points: pts, updated_at: new Date().toISOString() })
            .eq('member_id', pid).eq('event_date', date);
        }
      }
      return res.status(200).json({ ok: true, standings: table });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return safeError(res, 'padel-night', e, 'Could not update the night.');
  }
};
