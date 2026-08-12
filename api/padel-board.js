// GET /api/padel-board?date=YYYY-MM-DD - PUBLIC (read-only). Everything the TV
// board and the scoring page render, in one round trip.
//
// King of the Court, LFG format: 16 players, 8 teams of 2, 4 courts, 15-minute
// rounds with a 2-minute rotation. Court 1 is The Throne. Winners climb toward
// it, losers drop away from it.
//
// The board is a READ. Nothing here writes, and it carries no player contact
// details — it is displayed on a TV in a public venue, so it returns first name
// plus last initial, the same privacy posture as /api/padel-leaderboard.
const { admin, safeError } = require('./_lib');
const { resolveEvent } = require('./padel-status');

// A win is 3 points. Games won are the tiebreak, never the ranking: a team that
// wins three tight matches beats a team that wins two and gets thrashed once.
const WIN_POINTS = 3;

function shortName(full, email) {
  const raw = String(full || '').trim() || String(email || '').split('@')[0] || '';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Player';
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase();
}

// Standings from the played matches alone, so the board can never disagree with
// the scores: there is no stored total to drift out of sync.
function standings(teams, matches) {
  const table = new Map();
  for (const t of teams) {
    table.set(t.team_no, { team_no: t.team_no, name: t.name, points: 0, wins: 0, losses: 0, gf: 0, ga: 0 });
  }
  for (const m of matches) {
    if (m.score_a == null || m.score_b == null) continue;
    const a = table.get(m.team_a), b = table.get(m.team_b);
    if (!a || !b) continue;
    a.gf += m.score_a; a.ga += m.score_b;
    b.gf += m.score_b; b.ga += m.score_a;
    if (m.score_a > m.score_b) { a.wins++; a.points += WIN_POINTS; b.losses++; }
    else if (m.score_b > m.score_a) { b.wins++; b.points += WIN_POINTS; a.losses++; }
  }
  return [...table.values()].sort((x, y) =>
    y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team_no - y.team_no
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
        .select('team_no, player_a, player_b, members_a:members!padel_teams_player_a_fkey(full_name, email), members_b:members!padel_teams_player_b_fkey(full_name, email)')
        .eq('event_date', date).order('team_no'),
      db.from('padel_matches')
        .select('round, court, team_a, team_b, score_a, score_b')
        .eq('event_date', date).order('round').order('court'),
      db.from('padel_night').select('*').eq('event_date', date).maybeSingle()
    ]);

    const teams = (teamsRes.data || []).map((t) => {
      const a = Array.isArray(t.members_a) ? t.members_a[0] : t.members_a;
      const b = Array.isArray(t.members_b) ? t.members_b[0] : t.members_b;
      const names = [shortName(a && a.full_name, a && a.email)];
      if (t.player_b) names.push(shortName(b && b.full_name, b && b.email));
      return { team_no: t.team_no, name: names.join(' & '), players: names };
    });

    const matches = matchesRes.data || [];
    const night = nightRes.data || null;
    const round = night ? night.current_round : (matches.reduce((m, x) => Math.max(m, x.round), 0) || 1);

    return res.status(200).json({
      ready: teams.length > 0,
      event_date: date,
      location: (cfg && cfg.padel_location) || 'Dubai',
      capacity: Number((cfg && cfg.padel_capacity) || 16),
      teams,
      matches,
      standings: standings(teams, matches),
      round,
      round_started_at: night ? night.round_started_at : null,
      round_minutes: night ? night.round_minutes : 15,
      break_minutes: night ? night.break_minutes : 2,
      // The board polls; this lets it skip a repaint when nothing moved.
      version: matches.reduce((n, m) => n + (m.score_a == null ? 0 : 1), 0) + ':' + round
    });
  } catch (e) {
    return safeError(res, 'padel-board', e, 'Could not load the board.');
  }
};
