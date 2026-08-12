// POST /api/admin/award-points - owner-only. Adds bootcamp points to a member's
// leaderboard total. Body: { member_id? | member_email, points, reason? }
// Points can be negative to correct a mistake. Auto run-points (10/run) are NOT
// touched here - this is the manual bootcamp award only. Every award is stamped
// with the acting admin's id for audit.
const { admin, getUser, isAdmin, memberPoints } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  let memberId = String(body.member_id || '').trim();
  const memberEmail = typeof body.member_email === 'string' ? body.member_email.trim().toLowerCase() : '';
  const points = Number(body.points);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';

  // The admin Members table only carries email client-side - resolve to id.
  if (!memberId && memberEmail) {
    const { data: m } = await db.from('members').select('id').eq('email', memberEmail).maybeSingle();
    if (m && m.id) memberId = m.id;
  }

  if (!memberId) return res.status(400).json({ error: 'Member not found' });
  if (!Number.isInteger(points) || points === 0) return res.status(400).json({ error: 'Points must be a non-zero integer' });
  if (Math.abs(points) > 1000) return res.status(400).json({ error: 'Points out of range (max ±1000)' });

  try {
    const { error } = await db.from('point_awards').insert({
      member_id: memberId,
      points: points,
      reason: reason || null,
      awarded_by: user.id
    });
    if (error) return res.status(500).json({ error: error.message });

    const totals = await memberPoints(db, memberId);
    return res.status(200).json({ ok: true, added: points, points_total: totals.points, runs: totals.runs, bootcamps: totals.bootcamps, bonus: totals.bonus });
  } catch (e) {
    console.error('[/api/admin/award-points]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
