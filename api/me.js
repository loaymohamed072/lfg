// GET /api/me - returns the logged-in member's credits, attendance, and upcoming bookings.
// Creates the member record on first login.
const { admin, getUser, buildMeResponse } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = await buildMeResponse(admin(), user);
    res.status(200).json(payload);
  } catch (err) {
    console.error('[/api/me]', err);
    res.status(500).json({ error: 'Failed to load account' });
  }
};
