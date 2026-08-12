// GET /api/checkin-state - is bootcamp check-in live right now?
// Public on purpose: the QR page calls this BEFORE asking anyone to sign in, so
// a stranger who scans the roll-up banner mid-week goes to the bootcamp page to
// book instead of hitting a sign-in wall.
//
// Returns no member data. All the window logic sits in the
// bootcamp_checkin_state() SECURITY DEFINER function, next to check_in_member().
const { admin } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sessionId = (req.query && req.query.session_id) || null;

  try {
    const { data, error } = await admin().rpc('bootcamp_checkin_state', {
      p_session_id: sessionId
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || { open: false, reason: 'unknown' });
  } catch (e) {
    console.error('[/api/checkin-state]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
