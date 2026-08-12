// POST /api/admin/mark-attendance - owner marks a booking attended / no-show / booked. Admin only.
// Body: { booking_id, status }
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  if (!body.booking_id || !['booked', 'attended', 'no_show'].includes(body.status)) {
    return res.status(400).json({ error: 'Bad request' });
  }
  try {
    const { error } = await db.from('bookings')
      .update({ status: body.status, checked_in_at: body.status === 'attended' ? new Date().toISOString() : null })
      .eq('id', body.booking_id);
    if (error) throw new Error(error.message);

    // Push to GHL only on attendance transitions (not no-show / un-mark). Fire-and-forget.
    if (body.status === 'attended') {
      try {
        const { data: b } = await db.from('bookings').select('member_id').eq('id', body.booking_id).maybeSingle();
        if (b && b.member_id) {
          const { data: m } = await db.from('members').select('email,full_name').eq('id', b.member_id).maybeSingle();
          if (m && m.email) {
            const ghl = require('../_ghl');
            const [firstName, ...rest] = (m.full_name || '').split(' ');
            await ghl.onAttendance({
              email: m.email,
              firstName: firstName || undefined,
              lastName: rest.length ? rest.join(' ') : undefined,
              kind: 'bootcamp'
            });
          }
        }
      } catch (e) { console.warn('[mark-attendance → ghl]', e && e.message); }
    }

    res.status(200).json({ ok: true, status: body.status });
  } catch (e) {
    console.error('[/api/admin/mark-attendance]', e);
    res.status(500).json({ error: 'Update failed' });
  }
};
