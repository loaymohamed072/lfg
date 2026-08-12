// GET /api/leaderboard - public combined leaderboard: bootcamps attended + runs
// attended, this month and all time. If the caller is signed in, also returns their
// own rank so the page can highlight it. Names are first-name + last-initial.
const { admin, getUser } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const user = await getUser(req); // optional
    const db = admin();
    const { data, error } = await db.rpc('lfg_leaderboard', { p_member: user ? user.id : null });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || {});
  } catch (e) {
    console.error('[/api/leaderboard]', e);
    return res.status(500).json({ error: 'Failed to load leaderboard' });
  }
};
