// POST /api/admin/set-session-theme - the weekly bootcamp theme (e.g. HYROX, DEKA) for upcoming
// Sundays. Shown on the bootcamp page and in /api/next-bootcamp, which the Instagram bot reads.
// Admin only. Body: { themes: [{ session_id, theme }] }  ('' clears a theme; 40 characters max)
const { admin, getUser, isAdmin } = require('../_lib');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const list = req.body && Array.isArray(req.body.themes) ? req.body.themes : null;
  if (!list || !list.length || list.length > 12) return res.status(400).json({ error: 'Send 1 to 12 themes' });
  for (const t of list) {
    if (!t || !UUID.test(String(t.session_id || ''))) return res.status(400).json({ error: 'Bad session id' });
    if (t.theme != null && typeof t.theme !== 'string') return res.status(400).json({ error: 'Theme must be text' });
  }

  try {
    // Past Sundays keep the theme they ran with.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    let applied = 0;
    for (const t of list) {
      const theme = String(t.theme || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const { data, error } = await db.from('sessions').update({ theme: theme || null })
        .eq('id', t.session_id).gte('session_date', today).select('id');
      if (error) throw new Error(error.message);
      applied += (data || []).length;
    }
    return res.status(200).json({ ok: true, applied });
  } catch (e) {
    console.error('[/api/admin/set-session-theme]', e);
    return res.status(500).json({ error: 'Could not save the theme' });
  }
};
