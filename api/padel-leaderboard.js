// GET /api/padel-leaderboard - PUBLIC. The padel night's own top players, for
// the board on /padel.
//
// Ahmed, 2026-08-10: "in this PADL site we can have a section for the PADL
// score, but when you go in the portal it has a multiplier and it will add to
// the total score... an independent one, just a quick top five here, and the
// big one where you can [see everything]."
//
// So this is deliberately NOT the portal leaderboard. It reports padel match
// points as they were actually scored (2, 3, 6 a night), because that is the
// number a player argues about court-side. The ×100 conversion into the
// community total lives in lfg_leaderboard, not here.
//
// padel_signups is service-role only, so the aggregate has to be built here
// rather than read from the browser. Names come back first-name + last-initial,
// the same privacy posture as the community leaderboard.
const { admin, safeError } = require('./_lib');

const TOP_N = 5;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = admin();

    // Only nights actually paid for: an unpaid row is a dropped booking, not a
    // player, and it must never appear on a public board.
    const { data: rows, error } = await db
      .from('padel_signups')
      .select('member_id, points, event_date')
      .eq('paid', true);
    if (error) throw error;

    const byMember = new Map();
    for (const r of rows || []) {
      const cur = byMember.get(r.member_id) || { points: 0, nights: 0 };
      cur.points += Number(r.points || 0);
      cur.nights += 1;
      byMember.set(r.member_id, cur);
    }

    // Nobody has scored yet: an empty board is the honest answer, and the page
    // hides the section rather than showing a podium of zeroes.
    const scored = [...byMember.entries()].filter(([, v]) => v.points > 0);
    if (scored.length === 0) {
      return res.status(200).json({ players: [], total_players: byMember.size });
    }

    const ids = scored.map(([id]) => id);
    const { data: members } = await db
      .from('members')
      .select('id, full_name')
      .in('id', ids);
    const names = new Map((members || []).map((m) => [m.id, m.full_name]));

    // First name + last initial. Same shape as short_name() in the portal.
    const shortName = (full) => {
      const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return 'LFG player';
      if (parts.length === 1) return parts[0];
      return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
    };

    const players = scored
      .map(([id, v]) => ({
        name: shortName(names.get(id)),
        points: v.points,
        nights: v.nights,
      }))
      // Points first; more points from fewer nights ranks higher on a tie.
      .sort((a, b) => b.points - a.points || a.nights - b.nights)
      .slice(0, TOP_N)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    return res.status(200).json({ players, total_players: byMember.size });
  } catch (e) {
    return safeError(res, 'padel-leaderboard', e, 'Could not load the padel board.');
  }
};
