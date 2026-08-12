// POST /api/admin/set-session-stations - change the group/station count for ONE session and
// auto-rebalance anyone in a removed station into the remaining ones (evenly, oldest first).
// Body: { session_id, stations }  (stations 1-8)
//
// This is the per-session override. The global setter (set-stations.js) refuses to drop a
// session below an occupied station so no one gets orphaned; this endpoint instead MOVES those
// people, which is what you want when cancelling e.g. station D on the day.
//
// Stations drive the booking station picker, the roster + roster email, and the admin session
// view (all read session.stations live), so this single change reflects everywhere. Points are
// not station-based, so they are unaffected.
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const n = parseInt(body.stations, 10);
  if (!body.session_id || isNaN(n) || n < 1 || n > 8) {
    return res.status(400).json({ error: 'Groups must be between 1 and 8' });
  }
  try {
    const { data: bks, error: be } = await db.from('bookings')
      .select('id,section,booked_at,status')
      .eq('session_id', body.session_id).neq('status', 'cancelled');
    if (be) throw new Error(be.message);

    const labels = [];
    for (let i = 0; i < n; i++) labels.push(String.fromCharCode(65 + i)); // A, B, C, ...
    const valid = new Set(labels);

    // Count who already sits in a still-valid station.
    const counts = {};
    labels.forEach(l => { counts[l] = 0; });
    (bks || []).forEach(b => { if (b.section && valid.has(b.section)) counts[b.section]++; });

    // Anyone in a removed station (or unassigned) moves into the emptiest valid station,
    // oldest booking first, so the result is stable and balanced.
    const outOfRange = (bks || [])
      .filter(b => !b.section || !valid.has(b.section))
      .sort((a, b) => String(a.booked_at || '').localeCompare(String(b.booked_at || '')));
    const byTarget = {};
    outOfRange.forEach(b => {
      let best = labels[0];
      labels.forEach(l => { if (counts[l] < counts[best]) best = l; });
      counts[best]++;
      (byTarget[best] = byTarget[best] || []).push(b.id);
    });

    for (const lab of Object.keys(byTarget)) {
      const { error } = await db.from('bookings').update({ section: lab }).in('id', byTarget[lab]);
      if (error) throw new Error(error.message);
    }

    const { error: se } = await db.from('sessions').update({ stations: n }).eq('id', body.session_id);
    if (se) throw new Error(se.message);

    res.status(200).json({ ok: true, stations: n, moved: outOfRange.length, counts });
  } catch (e) {
    console.error('[/api/admin/set-session-stations]', e);
    res.status(500).json({ error: 'Update failed' });
  }
};
