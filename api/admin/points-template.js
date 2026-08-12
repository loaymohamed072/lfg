// GET /api/admin/points-template - owner/coach (admin) only. Returns the roster
// for a session as { member_id, name } rows so the admin can download a ready
// points sheet (hidden IDs + names, blank points column) and hand it to coaches.
//
// Picks today's session by default; ?session_id=… overrides. Falls back to the
// next upcoming session, then the most recent past one, so the button always
// has something useful.
const { admin, getUser, isAdmin, formatDate } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    let sess = null;
    const sid = (req.query || {}).session_id;
    if (sid) {
      const { data } = await db.from('sessions').select('id,session_date,start_time,location').eq('id', sid).maybeSingle();
      sess = data || null;
    } else {
      // Dubai "today" (UTC+4) so the same-day session is picked correctly.
      const dubaiDay = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
      // 1) exact today, 2) next upcoming, 3) most recent past.
      const today = await db.from('sessions').select('id,session_date,start_time,location').eq('session_date', dubaiDay).maybeSingle();
      sess = today.data || null;
      if (!sess) {
        const up = await db.from('sessions').select('id,session_date,start_time,location').gte('session_date', dubaiDay).order('session_date', { ascending: true }).limit(1);
        sess = (up.data && up.data[0]) || null;
      }
      if (!sess) {
        const past = await db.from('sessions').select('id,session_date,start_time,location').order('session_date', { ascending: false }).limit(1);
        sess = (past.data && past.data[0]) || null;
      }
    }
    if (!sess) return res.status(404).json({ error: 'No session found' });

    const { data: bks } = await db.from('bookings')
      .select('member_id,section,status')
      .eq('session_id', sess.id).in('status', ['booked', 'attended']);

    const ids = [...new Set((bks || []).map(b => b.member_id))];
    let members = [];
    if (ids.length) {
      const { data: ms } = await db.from('members').select('id,full_name,email').in('id', ids);
      const secById = {};
      (bks || []).forEach(b => { secById[b.member_id] = b.section || ''; });
      members = (ms || []).map(m => ({
        member_id: m.id,
        name: m.full_name || (m.email || '').split('@')[0],
        email: m.email || '',
        section: secById[m.id] || ''
      })).sort((a, b) =>
        // Group by station (A,B,C,D...) first, unassigned last, then name.
        ((a.section || '~').localeCompare(b.section || '~')) || a.name.localeCompare(b.name)
      );
    }

    return res.status(200).json({
      session: { id: sess.id, date: sess.session_date, date_label: formatDate(sess.session_date, sess.start_time), location: sess.location || '' },
      count: members.length,
      members: members
    });
  } catch (e) {
    console.error('[/api/admin/points-template]', e);
    return res.status(500).json({ error: 'Failed to build template' });
  }
};
