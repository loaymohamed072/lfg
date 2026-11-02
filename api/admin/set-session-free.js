// POST /api/admin/set-session-free - make an upcoming Sunday free, or paid again (Loay, 2 Nov 2026).
// On a free Sunday everyone books at AED 0 with no card and no credit (book_free), friends
// join free, and a cancelled free spot gives nothing back. Bookings already paid for that
// Sunday stay as they are. Admin only. Body: { sessions: [{ session_id, is_free }] }
const { admin, getUser, isAdmin } = require('../_lib');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const list = req.body && Array.isArray(req.body.sessions) ? req.body.sessions : null;
  if (!list || !list.length || list.length > 12) return res.status(400).json({ error: 'Send 1 to 12 Sundays' });
  for (const s of list) {
    if (!s || !UUID.test(String(s.session_id || ''))) return res.status(400).json({ error: 'Bad session id' });
    if (typeof s.is_free !== 'boolean') return res.status(400).json({ error: 'is_free must be true or false' });
  }

  try {
    // Past Sundays keep what they ran as.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    let applied = 0;
    for (const s of list) {
      const { data, error } = await db.from('sessions').update({ is_free: s.is_free })
        .eq('id', s.session_id).gte('session_date', today).select('id');
      if (error) throw new Error(error.message);
      applied += (data || []).length;
    }
    return res.status(200).json({ ok: true, applied });
  } catch (e) {
    console.error('[/api/admin/set-session-free]', e);
    return res.status(500).json({ error: 'Could not save the free Sunday' });
  }
};
