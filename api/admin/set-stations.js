// POST /api/admin/set-stations - apply the bootcamp station count (and, optionally,
// the venue) to every upcoming session. The global defaults live in
// api.lfg_event_config and are written by the admin browser (RLS-authorised); this
// endpoint only writes lfg_dev.sessions, which the service role can do. That keeps
// the server off the api schema entirely. Admin only. Body: { stations, location? }
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const n = parseInt(body.stations, 10);
  if (isNaN(n) || n < 2 || n > 12) return res.status(400).json({ error: 'Stations must be 2–12' });
  const location = (typeof body.location === 'string' && body.location.trim()) ? body.location.trim() : null;

  try {
    const today = new Date(new Date().toDateString()).toISOString().slice(0, 10);
    const { data: sess, error: selErr } = await db.from('sessions').select('id').gte('session_date', today);
    if (selErr) throw new Error(selErr.message);
    const ids = (sess || []).map(s => s.id);

    // Never drop a session below a station that already has bookings.
    const maxIdxBy = {};
    if (ids.length) {
      const { data: bk } = await db.from('bookings').select('session_id,section')
        .in('session_id', ids).in('status', ['booked', 'attended']);
      (bk || []).forEach(b => {
        if (!b.section) return;
        const idx = b.section.charCodeAt(0) - 65;
        if (idx > (maxIdxBy[b.session_id] == null ? -1 : maxIdxBy[b.session_id])) maxIdxBy[b.session_id] = idx;
      });
    }

    let applied = 0, skipped = 0;
    for (const s of (sess || [])) {
      const minNeeded = (maxIdxBy[s.id] == null ? -1 : maxIdxBy[s.id]) + 1;
      const patch = {};
      if (n >= minNeeded) { patch.stations = n; applied++; } else { skipped++; }
      if (location) patch.location = location;
      if (Object.keys(patch).length) {
        const { error: uErr } = await db.from('sessions').update(patch).eq('id', s.id);
        if (uErr) throw new Error(uErr.message);
      }
    }

    res.status(200).json({ ok: true, stations: n, applied, skipped });
  } catch (e) {
    console.error('[/api/admin/set-stations]', e);
    res.status(500).json({ error: 'Failed to update stations' });
  }
};
