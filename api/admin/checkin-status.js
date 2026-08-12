// GET /api/admin/checkin-status - live "who's here vs not yet" for today's session.
// Used by the Today tab in admin to auto-refresh every ~15s during a session.
// Falls back to the next upcoming session if there isn't one today.
//
// Auth: admin user OR cron token (so a live ops board could poll without an
// admin login if Ahmed wants to project it somewhere).
const { admin, getUser, isAdmin, formatDate, safeError } = require('../_lib');

async function authorise(req, db) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token && process.env.LFG_CRON_TOKEN && token === process.env.LFG_CRON_TOKEN) {
    return { ok: true };
  }
  const user = await getUser(req);
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' };
  if (!(await isAdmin(db, user.id))) return { ok: false, status: 403, error: 'Admins only' };
  return { ok: true };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const db = admin();
  const auth = await authorise(req, db);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    // Today's open session, else the next upcoming one
    let { data: session } = await db.from('sessions')
      .select('id,session_date,start_time,location,capacity,status')
      .eq('session_date', todayIso).eq('status', 'open').maybeSingle();
    if (!session) {
      const r = await db.from('sessions')
        .select('id,session_date,start_time,location,capacity,status')
        .gte('session_date', todayIso).eq('status', 'open')
        .order('session_date', { ascending: true })
        .limit(1).maybeSingle();
      session = r.data;
    }
    if (!session) return res.status(200).json({ session: null });

    const { data: bookings, error } = await db.from('bookings')
      .select('id,status,section,checked_in_at,booked_at,member:members(id,full_name,email)')
      .eq('session_id', session.id)
      .in('status', ['booked', 'attended'])
      .order('booked_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    // Phone numbers live on run_registrations, not members. Pull them in a second hop.
    const memberIds = (bookings || []).map(b => b.member && b.member.id).filter(Boolean);
    const phoneByMember = {};
    if (memberIds.length) {
      const { data: regs } = await db.from('run_registrations')
        .select('member_id,whatsapp_e164').in('member_id', memberIds);
      (regs || []).forEach(r => { if (r.member_id && r.whatsapp_e164) phoneByMember[r.member_id] = r.whatsapp_e164; });
    }

    const checkedIn = [];
    const notYet = [];
    (bookings || []).forEach(b => {
      const m = b.member || {};
      const row = {
        booking_id: b.id,
        name: m.full_name || (m.email ? m.email.split('@')[0] : 'Member'),
        email: m.email || null,
        whatsapp: phoneByMember[m.id] || null,
        section: b.section || null,
        checked_in_at: b.checked_in_at,
        booked_at: b.booked_at
      };
      if (b.status === 'attended') checkedIn.push(row); else notYet.push(row);
    });

    // checked_in_at desc so the most recent arrival is on top of the "Just here" list
    checkedIn.sort((a, b) => new Date(b.checked_in_at || 0) - new Date(a.checked_in_at || 0));

    return res.status(200).json({
      session: {
        id: session.id,
        date_label: formatDate(session.session_date, session.start_time),
        date: session.session_date,
        start_time: session.start_time,
        location: session.location,
        capacity: session.capacity,
        is_today: session.session_date === todayIso
      },
      total_booked: checkedIn.length + notYet.length,
      total_checked_in: checkedIn.length,
      checked_in: checkedIn,
      not_yet: notYet
    });
  } catch (e) {
    return safeError(res, '/api/admin/checkin-status', e, 'Check-in status unavailable');
  }
};
