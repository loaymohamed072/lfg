// GET /api/admin/roster?session_id=… - attendee roster for one session. Admin only.
const { admin, getUser, isAdmin, formatDate } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const sid = (req.query || {}).session_id;
  if (!sid) return res.status(400).json({ error: 'Missing session_id' });

  try {
    const { data: sess } = await db.from('sessions').select('id,session_date,start_time,location,capacity,stations').eq('id', sid).single();
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const { data: bks } = await db.from('bookings')
      .select('id,section,status,payment_type,member_id,checked_in_at')
      .eq('session_id', sid).neq('status', 'cancelled')
      .order('section');

    const ids = [...new Set((bks || []).map(b => b.member_id))];
    const memById = {};
    const attendedBefore = new Set(); // members who have ever attended a bootcamp
    if (ids.length) {
      const [{ data: ms }, { data: att }] = await Promise.all([
        db.from('members').select('id,email,full_name').in('id', ids),
        db.from('bookings').select('member_id').in('member_id', ids).eq('status', 'attended')
      ]);
      (ms || []).forEach(m => { memById[m.id] = m; });
      // A member is a "first-timer" until they have at least one attended bootcamp.
      // Checking in this session flips their booking to attended, so the tag clears
      // automatically on the next roster load.
      (att || []).forEach(r => { if (r.member_id) attendedBefore.add(r.member_id); });
    }

    const attendees = (bks || []).map(b => ({
      booking_id: b.id,
      section: b.section,
      status: b.status,
      payment_type: b.payment_type,
      email: (memById[b.member_id] || {}).email || '',
      name: (memById[b.member_id] || {}).full_name || '',
      first_timer: !attendedBefore.has(b.member_id)
    }));

    res.status(200).json({
      session: { id: sess.id, date_label: formatDate(sess.session_date, sess.start_time), location: sess.location, capacity: sess.capacity, stations: sess.stations || 4 },
      attendees
    });
  } catch (e) {
    console.error('[/api/admin/roster]', e);
    res.status(500).json({ error: 'Failed to load roster' });
  }
};
