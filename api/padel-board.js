// GET /api/padel-board?date=YYYY-MM-DD - PUBLIC (read-only). Everything the TV
// board and the scoring page render, in one round trip.
//
// King of the Court, LFG format: 16 players, 4 courts of 4, rotating partners.
// Court 1 is The Throne. Winners climb toward it, losers drop away from it, and
// the pair that travels together is split on arrival. Scoring is INDIVIDUAL: win
// the game and you bank the games your side won, lose and you bank nothing.
//
// The board is a READ. Nothing here writes, and it carries no player contact
// details — it is displayed on a TV in a public venue, so it returns first name
// plus last initial, the same privacy posture as /api/padel-leaderboard.
const { admin, safeError } = require('./_lib');
const { resolveEvent } = require('./padel-status');

function shortName(full, email) {
  const raw = String(full || '').trim() || String(email || '').split('@')[0] || '';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Player';
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase();
}

// Standings are PER PLAYER and derived from the played matches alone, so the
// board can never disagree with the scores: there is no stored total to drift
// out of sync. Points are the games banked on wins; losses bank nothing, which
// is why `played` and `wins` are reported separately (a 0 can mean "lost every
// round" or "has not played yet", and those look very different court-side).
function standings(teamsByRound, matches, nameOf) {
  const row = new Map();
  const seat = (id) => {
    if (!id) return null;
    if (!row.has(id)) {
      row.set(id, { member_id: id, name: nameOf(id), points: 0, wins: 0, losses: 0, played: 0, gf: 0, ga: 0 });
    }
    return row.get(id);
  };
  for (const t of teamsByRound.values()) { seat(t.player_a); seat(t.player_b); }

  for (const m of matches) {
    if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) continue;
    const ta = teamsByRound.get(m.round + ':' + m.team_a);
    const tb = teamsByRound.get(m.round + ':' + m.team_b);
    if (!ta || !tb) continue;
    const aWon = m.score_a > m.score_b;
    const sides = [
      { team: ta, won: aWon, gf: m.score_a, ga: m.score_b },
      { team: tb, won: !aWon, gf: m.score_b, ga: m.score_a }
    ];
    for (const s of sides) {
      for (const pid of [s.team.player_a, s.team.player_b]) {
        const r = seat(pid);
        if (!r) continue;
        r.played++;
        r.gf += s.gf;
        r.ga += s.ga;
        if (s.won) { r.wins++; r.points += s.gf; } else { r.losses++; }
      }
    }
  }

  return [...row.values()].sort((x, y) =>
    y.points - x.points || y.wins - x.wins || (y.gf - y.ga) - (x.gf - x.ga) || x.name.localeCompare(y.name)
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = admin();
    const { data: cfg } = await db.from('event_config')
      .select('padel_enabled, padel_datetime, padel_location, padel_capacity')
      .eq('id', 1).maybeSingle();
    const current = cfg && cfg.padel_datetime ? resolveEvent(cfg.padel_datetime) : null;
    const q = req.query && req.query.date;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q || '')) ? String(q) : (current && current.ymd);
    if (!date) return res.status(200).json({ ready: false, error: 'No padel night configured.' });

    const [teamsRes, matchesRes, nightRes] = await Promise.all([
      db.from('padel_teams')
        .select('round, team_no, player_a, player_b, members_a:members!padel_teams_player_a_fkey(full_name, email), members_b:members!padel_teams_player_b_fkey(full_name, email)')
        .eq('event_date', date).order('round').order('team_no'),
      db.from('padel_matches')
        .select('round, court, team_a, team_b, score_a, score_b')
        .eq('event_date', date).order('round').order('court'),
      db.from('padel_night').select('*').eq('event_date', date).maybeSingle()
    ]);

    const rawTeams = teamsRes.data || [];
    const matches = matchesRes.data || [];
    const night = nightRes.data || null;
    const round = night ? night.current_round : (matches.reduce((m, x) => Math.max(m, x.round), 0) || 1);

    // One name per member id, harvested from whichever pairing embedded them.
    const names = new Map();
    const one = (v) => (Array.isArray(v) ? v[0] : v);
    for (const t of rawTeams) {
      const a = one(t.members_a), b = one(t.members_b);
      if (t.player_a && !names.has(t.player_a)) names.set(t.player_a, shortName(a && a.full_name, a && a.email));
      if (t.player_b && !names.has(t.player_b)) names.set(t.player_b, shortName(b && b.full_name, b && b.email));
    }
    const nameOf = (id) => names.get(id) || 'Player';

    const byRound = new Map(rawTeams.map((t) => [t.round + ':' + t.team_no, t]));

    // `teams` is the CURRENT round's pairings, which is what both screens draw.
    // The pairing is a fact about this round only, so it carries its round with
    // it and the board never renders a stale partner after a rotation.
    const teams = rawTeams
      .filter((t) => t.round === round)
      .map((t) => {
        const players = [nameOf(t.player_a)];
        if (t.player_b) players.push(nameOf(t.player_b));
        return {
          team_no: t.team_no,
          round: t.round,
          name: players.join(' & '),
          players,
          member_ids: [t.player_a, t.player_b].filter(Boolean)
        };
      });

    return res.status(200).json({
      ready: teams.length > 0,
      event_date: date,
      location: (cfg && cfg.padel_location) || 'Dubai',
      capacity: Number((cfg && cfg.padel_capacity) || 16),
      format: 'rotating',
      teams,
      matches,
      standings: standings(byRound, matches, nameOf),
      round,
      // Set once Ahmed calls the night. The board reads it to stop the clock
      // and crown the leader instead of counting down a round nobody is playing.
      finished_at: (night && night.finished_at) || null,
      round_started_at: night ? night.round_started_at : null,
      round_minutes: night ? night.round_minutes : 15,
      break_minutes: night ? night.break_minutes : 2,
      // The board polls; this lets it skip a repaint when nothing moved. Round is
      // in the key because a rotation repaints every card even at equal scores.
      version: matches.reduce((n, m) => n + (m.score_a == null ? 0 : 1), 0) + ':' + round
    });
  } catch (e) {
    return safeError(res, 'padel-board', e, 'Could not load the board.');
  }
};
