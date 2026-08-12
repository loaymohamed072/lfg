// POST /api/admin/adjust-credits - owner-only, atomic, fully audited.
// Body: { member_id, delta, reason, expires_days? }
// All work happens inside the adjust_credits() RPC: positive delta creates a
// fresh comp pack, negative delta subtracts from existing active packs
// (oldest-expiring first), floor-protected at 0. The actor admin's id is
// stamped on every audit row so you can answer "who comped what".
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  let memberId = String(body.member_id || '').trim();
  const memberEmail = typeof body.member_email === 'string' ? body.member_email.trim().toLowerCase() : '';
  const delta = Number(body.delta);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const expiresDays = body.expires_days == null ? 60 : Number(body.expires_days);

  // Allow lookup by email - the admin Members table doesn't carry member_id client-side.
  if (!memberId && memberEmail) {
    const { data: m } = await db.from('members').select('id').eq('email', memberEmail).maybeSingle();
    if (m && m.id) memberId = m.id;
  }

  if (!memberId) return res.status(400).json({ error: 'Member not found' });
  if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ error: 'Delta must be a non-zero integer' });
  if (Math.abs(delta) > 100) return res.status(400).json({ error: 'Delta out of range (max ±100)' });
  if (!reason || reason.length < 4) return res.status(400).json({ error: 'Reason required (at least a few words)' });
  if (reason.length > 500) return res.status(400).json({ error: 'Reason too long' });
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 365) return res.status(400).json({ error: 'Expiry must be 1–365 days' });

  try {
    const { data, error } = await db.rpc('adjust_credits', {
      p_member_id: memberId,
      p_actor_admin_id: user.id,
      p_delta: delta,
      p_reason: reason,
      p_expires_days: expiresDays
    });
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.ok !== true) return res.status(400).json(data || { ok: false, error: 'Adjustment failed' });
    return res.status(200).json(data);
  } catch (e) {
    console.error('[/api/admin/adjust-credits]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
