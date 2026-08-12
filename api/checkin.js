// POST /api/checkin - member self check-in via QR.
// Body: { session_id? }  (optional - server defaults to today's session)
// Auth: requires member JWT. Anonymous traffic gets a clear "sign in first" message.
//
// All the time-window / booking lookup happens inside the SECURITY DEFINER
// check_in_member() RPC, so anon cannot bypass by calling the RPC directly.
const { admin, getUser, ensureMember } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated', need_signin: true });

  const body = (req.method === 'POST' && req.body) || {};
  const sessionId = body.session_id || (req.query && req.query.session_id) || null;

  try {
    const db = admin();
    await ensureMember(db, user);
    const { data, error } = await db.rpc('check_in_member', {
      p_user_id: user.id,
      p_session_id: sessionId
    });
    if (error) return res.status(500).json({ error: error.message });
    // Pass through whatever the RPC returned - the page can render it directly.
    return res.status(data && data.ok ? 200 : 200).json(data || { ok: false, error: 'Unknown' });
  } catch (e) {
    console.error('[/api/checkin]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
