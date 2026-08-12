// GET /api/admin/today - one-screen owner dashboard:
//   - this_week_revenue + delta vs last week
//   - new_members_this_week + delta vs last week
//   - sundays_at_risk: upcoming Sundays >= 48h out that are < 50% full
//   - convertible_runners: registered runners with no bootcamp activity
//   - noshow_rate_30d + trend vs prior 30d
//   - top_source_this_week: hear_source winner this week
//   - upcoming_next: the very next session with fill summary
const { admin, getUser, isAdmin, canViewRevenue, formatDate, safeError } = require('../_lib');

const DAY = 86400000;
const WEEK = 7 * DAY;
const TWO_DAYS = 2 * DAY;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });
  const cvr = await canViewRevenue(db, user.id);

  try {
    const now = Date.now();
    const weekAgo = now - WEEK;
    const twoWeeksAgo = now - 2 * WEEK;
    const thirtyAgo = now - 30 * DAY;
    const sixtyAgo = now - 60 * DAY;
    const today = new Date(now).toISOString().slice(0, 10);

    // Pull just enough data - one round-trip per table.
    const [payR, memR, bookR, sessR, runR] = await Promise.all([
      db.from('payments').select('amount_aed,created_at,status').eq('status', 'paid').gte('created_at', new Date(twoWeeksAgo).toISOString()),
      db.from('members').select('id,created_at,is_admin').neq('is_admin', true),
      db.from('bookings').select('member_id,session_id,status,booked_at').in('status', ['booked', 'attended', 'no_show', 'cancelled']),
      db.from('sessions').select('id,session_date,start_time,location,capacity,status').gte('session_date', today).order('session_date'),
      db.from('run_registrations').select('member_id,created_at,hear_source')
    ]);

    const payments = payR.data || [];
    const members = memR.data || [];
    const bookings = bookR.data || [];
    const sessions = sessR.data || [];
    const runners = runR.data || [];

    // Revenue - this week vs last week
    const sumIn = (arr, startMs, endMs) => arr.filter(p => {
      const t = new Date(p.created_at).getTime();
      return t >= startMs && t < endMs;
    }).reduce((a, p) => a + Number(p.amount_aed || 0), 0);

    const revThis = sumIn(payments, weekAgo, now);
    const revPrev = sumIn(payments, twoWeeksAgo, weekAgo);
    const revDeltaPct = revPrev > 0 ? Math.round(((revThis - revPrev) / revPrev) * 100) : null;

    // New members - this week vs last
    const newMemCount = (startMs, endMs) => members.filter(m => {
      if (!m.created_at) return false;
      const t = new Date(m.created_at).getTime();
      return t >= startMs && t < endMs;
    }).length;
    const newThis = newMemCount(weekAgo, now);
    const newPrev = newMemCount(twoWeeksAgo, weekAgo);

    // Sundays at risk: starts >= 48h from now AND fill < 50%
    const bookCountBySession = {};
    bookings.filter(b => b.status !== 'cancelled').forEach(b => {
      bookCountBySession[b.session_id] = (bookCountBySession[b.session_id] || 0) + 1;
    });
    const atRisk = sessions
      .map(s => {
        // Treat start as Dubai noon (close enough for the 48h check)
        const start = Date.parse(s.session_date + 'T12:30:00+04:00');
        const booked = bookCountBySession[s.id] || 0;
        const fillPct = s.capacity ? booked / s.capacity : 0;
        return { ...s, start, booked, fill_pct: Math.round(fillPct * 100) };
      })
      .filter(s => s.start - now >= TWO_DAYS && s.fill_pct < 50)
      .slice(0, 5)
      .map(s => ({
        id: s.id, date_label: formatDate(s.session_date, s.start_time),
        capacity: s.capacity, booked: s.booked, fill_pct: s.fill_pct,
        location: s.location
      }));

    // Convertible runners - have a registration but no bookings
    const memberHasBooking = {};
    bookings.filter(b => b.status !== 'cancelled' && b.member_id).forEach(b => { memberHasBooking[b.member_id] = true; });
    const convertibleCount = runners.filter(r => !r.member_id || !memberHasBooking[r.member_id]).length;

    // No-show rate: 30d window, of (attended + no_show), how many no-show
    const noShowRate = (startMs, endMs) => {
      const window = bookings.filter(b => {
        if (!b.booked_at) return false;
        const t = new Date(b.booked_at).getTime();
        if (t < startMs || t >= endMs) return false;
        return b.status === 'attended' || b.status === 'no_show';
      });
      const total = window.length;
      if (!total) return null;
      const noshows = window.filter(b => b.status === 'no_show').length;
      return Math.round((noshows / total) * 100);
    };
    const noshowThis = noShowRate(thirtyAgo, now);
    const noshowPrev = noShowRate(sixtyAgo, thirtyAgo);

    // Top hear-source this week
    const sourceCount = {};
    runners.filter(r => {
      if (!r.created_at) return false;
      const t = new Date(r.created_at).getTime();
      return t >= weekAgo && t < now && r.hear_source;
    }).forEach(r => { sourceCount[r.hear_source] = (sourceCount[r.hear_source] || 0) + 1; });
    let topSource = null;
    let topSourceCount = 0;
    Object.keys(sourceCount).forEach(k => { if (sourceCount[k] > topSourceCount) { topSource = k; topSourceCount = sourceCount[k]; } });

    // Next upcoming session (whatever it is)
    const upcomingNext = sessions[0]
      ? {
          id: sessions[0].id,
          date_label: formatDate(sessions[0].session_date, sessions[0].start_time),
          capacity: sessions[0].capacity,
          booked: bookCountBySession[sessions[0].id] || 0,
          location: sessions[0].location,
          hours_to_start: Math.max(0, Math.round((Date.parse(sessions[0].session_date + 'T12:30:00+04:00') - now) / 3600000))
        }
      : null;

    const this_week = { new_members: newThis, new_members_prev: newPrev };
    if (cvr) {
      this_week.revenue = Math.round(revThis * 100) / 100;
      this_week.revenue_delta_pct = revDeltaPct;
      this_week.revenue_prev = Math.round(revPrev * 100) / 100;
    }
    return res.status(200).json({
      can_view_revenue: cvr,
      this_week,
      sundays_at_risk: atRisk,
      convertible_runners: convertibleCount,
      noshow: { rate_30d: noshowThis, rate_prev_30d: noshowPrev },
      top_source_this_week: topSource ? { key: topSource, count: topSourceCount } : null,
      upcoming_next: upcomingNext
    });
  } catch (e) {
    return safeError(res, '/api/admin/today', e, 'Dashboard unavailable');
  }
};
