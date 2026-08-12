// GET /api/admin/past-bootcamps?page=1&per=10 - admin only. Every previous bootcamp (past
// sessions) since the site started, newest first, server-paginated, so coaches can browse the
// full history (roster, photo, points). Same row shape as the dashboard's recent camps.
const { admin, getUser, isAdmin, formatDate, stationLabelsN, sectionCapN } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const q = req.query || {};
  const per = Math.min(Math.max(parseInt(q.per, 10) || 10, 1), 50);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const offset = (page - 1) * per;

  try {
    // "Past" = Dubai calendar date strictly before today (session_date is a Dubai date string).
    const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    const { count, error: cErr } = await db.from('sessions')
      .select('id', { count: 'exact', head: true }).lt('session_date', todayYMD);
    if (cErr) return res.status(500).json({ error: cErr.message });

    const { data: sess, error } = await db.from('sessions')
      .select('id,session_date,start_time,location,capacity,status,stations,photo_url')
      .lt('session_date', todayYMD)
      .order('session_date', { ascending: false })
      .range(offset, offset + per - 1);
    if (error) return res.status(500).json({ error: error.message });

    // Booked totals + per-station counts for just this page's sessions (non-cancelled only,
    // matching the dashboard's counting).
    const ids = (sess || []).map(s => s.id);
    const bySession = {};
    if (ids.length) {
      const { data: books } = await db.from('bookings')
        .select('session_id,section,status').in('session_id', ids);
      (books || []).filter(b => b.status !== 'cancelled').forEach(b => {
        const e = bySession[b.session_id] || (bySession[b.session_id] = { total: 0, secs: {} });
        e.total++; if (b.section) e.secs[b.section] = (e.secs[b.section] || 0) + 1;
      });
    }

    const rows = (sess || []).map(s => {
      const e = bySession[s.id] || { total: 0, secs: {} };
      const n = s.stations || 4;
      return {
        id: s.id, date_label: formatDate(s.session_date, s.start_time), location: s.location || null,
        capacity: s.capacity, booked: e.total, stations: n, photo_url: s.photo_url || null, past: true,
        sections: stationLabelsN(n).map((l, i) => ({ label: l, booked: e.secs[l] || 0, cap: sectionCapN(s.capacity, i, n) }))
      };
    });

    const total = count || 0;
    return res.status(200).json({
      sessions: rows,
      page, per, total, pages: Math.max(1, Math.ceil(total / per)),
      has_more: offset + rows.length < total
    });
  } catch (e) {
    console.error('[/api/admin/past-bootcamps]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
