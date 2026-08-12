// GET /api/admin/runners - admin-only.
// Returns:
//   { runners: [...],            // full list with member_id + bootcamp_bookings + bootcamp_attended
//     convertible_count,         // runners with 0 bootcamp bookings
//     birthdays: [...],          // upcoming birthdays in the next 14 days
//     source_breakdown: {...} }  // counts grouped by hear_source for the source ROI card
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    const { data: runners, error: rErr } = await db.from('run_registrations')
      .select('id,member_id,email,first_name,last_name,whatsapp_e164,instagram_handle,date_of_birth,nationality,occupation,occupation_detail,interests,uae_tenure,level,hear_source,utm_source,utm_medium,utm_campaign,created_at')
      .order('created_at', { ascending: false });
    if (rErr) return res.status(500).json({ error: rErr.message });

    // For each runner with a member_id, count their booked + attended bootcamp bookings.
    const memberIds = (runners || []).map(r => r.member_id).filter(Boolean);
    const bookingsByMember = {};
    if (memberIds.length) {
      const { data: bks } = await db.from('bookings')
        .select('member_id,status')
        .in('member_id', memberIds)
        .in('status', ['booked', 'attended']);
      (bks || []).forEach(b => {
        const e = bookingsByMember[b.member_id] || (bookingsByMember[b.member_id] = { booked: 0, attended: 0 });
        if (b.status === 'attended') e.attended++; else e.booked++;
      });
    }

    // Count actual run attendances (QR check-ins) per member, so the admin can
    // filter/sort by how many runs someone has shown up to.
    const runsByMember = {};
    if (memberIds.length) {
      const { data: ra } = await db.from('run_attendance')
        .select('member_id')
        .in('member_id', memberIds);
      (ra || []).forEach(x => { runsByMember[x.member_id] = (runsByMember[x.member_id] || 0) + 1; });
    }

    const enriched = (runners || []).map(r => {
      const stats = (r.member_id && bookingsByMember[r.member_id]) || { booked: 0, attended: 0 };
      return Object.assign({}, r, {
        bootcamp_bookings: stats.booked,
        bootcamp_attended: stats.attended,
        runs_attended: (r.member_id && runsByMember[r.member_id]) || 0,
        is_convertible: !r.member_id || (stats.booked === 0 && stats.attended === 0)
      });
    });

    const convertible_count = enriched.filter(r => r.is_convertible).length;

    // Upcoming birthdays - next 14 days (ignoring year).
    const now = new Date();
    const todayMD = (now.getMonth() + 1) * 100 + now.getDate();
    const birthdays = enriched
      .filter(r => r.date_of_birth)
      .map(r => {
        const d = new Date(r.date_of_birth);
        const md = (d.getMonth() + 1) * 100 + d.getDate();
        // Days until next birthday (rough, ignores leap years).
        let nextYear = now.getFullYear();
        const candidate = new Date(nextYear, d.getMonth(), d.getDate());
        if (candidate < now) candidate.setFullYear(nextYear + 1);
        const days = Math.floor((candidate - now) / 86400000);
        return Object.assign({}, r, { birthday_md: md, days_until: days });
      })
      .filter(r => r.days_until <= 14)
      .sort((a, b) => a.days_until - b.days_until);

    // Source breakdown for the ROI card.
    const source_breakdown = {};
    enriched.forEach(r => {
      const s = r.hear_source || 'unknown';
      source_breakdown[s] = (source_breakdown[s] || 0) + 1;
    });

    res.status(200).json({
      runners: enriched,
      convertible_count,
      birthdays,
      source_breakdown
    });
  } catch (e) {
    console.error('[/api/admin/runners]', e);
    res.status(500).json({ error: 'Server error' });
  }
};
