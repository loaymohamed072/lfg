// GET /api/sessions - upcoming open Sunday sessions with live spots-left,
// plus per-station availability for the balancing picker.
//
// Station count and venue live on each session row (sessions.stations / location),
// kept in sync with the admin's global settings by /api/admin/set-stations. Reading
// them off the row means this public endpoint never needs the api schema. Also
// returns recent group photos (each tied to its Sunday) for the gallery.
const { admin, getUser, formatDate } = require('./_lib');

function stationLabels(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(String.fromCharCode(65 + i)); // A, B, C, …
  return out;
}
function sectionCap(total, idx, n) { return Math.floor(total / n) + (idx < (total % n) ? 1 : 0); }

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const db = admin();
  const user = await getUser(req); // optional

  try {
    // A session stays "upcoming" until its start time (Dubai, UTC+4) passes; after that
    // it rolls to the next Sunday. Query from yesterday to stay timezone-safe, then filter
    // by the exact start time below.
    const nowMs = Date.now();
    const todayStr = new Date(new Date().toDateString()).toISOString().slice(0, 10);
    const fromStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const SEL = 'id,session_date,start_time,location,capacity,status,stations,photo_url';

    // Calendar + recent group photos (past/today, newest first) in parallel.
    const [sessRes, photoRes] = await Promise.all([
      db.from('sessions').select(SEL).gte('session_date', fromStr).order('session_date'),
      db.from('sessions').select('session_date,start_time,photo_url').not('photo_url', 'is', null)
        .lte('session_date', todayStr).order('session_date', { ascending: false }).limit(6)
    ]);
    if (sessRes.error) throw new Error(sessRes.error.message);
    let sessions = sessRes.data || [];

    // Only synthesize missing Sundays when the calendar runs short - skips the
    // write-heavy RPC on the hot path.
    if (sessions.length < 6) {
      await db.rpc('ensure_upcoming_sundays', { p_weeks: 8 });
      const re = await db.from('sessions').select(SEL).gte('session_date', fromStr).order('session_date');
      if (re.error) throw new Error(re.error.message);
      sessions = re.data || [];
    }

    // Booking/payment stays open until 135 min AFTER the session start, RELATIVE to the start
    // time so it shifts automatically if the start changes (a 12:45 class stays open until
    // 3:00pm). This matches the check-in window close in the check_in_member DB function -
    // keep the two +135 values in sync. The session only rolls over to the next Sunday once
    // this window passes, so "next session" stays correct the rest of the week.
    const BOOK_GRACE_MS = 135 * 60 * 1000; // minutes after start that booking stays open
    sessions = sessions.filter(s => {
      const t = Date.parse(s.session_date + 'T' + (s.start_time || '12:30:00') + '+04:00');
      return isNaN(t) ? true : (t + BOOK_GRACE_MS) >= nowMs;
    });

    const ids = sessions.map(s => s.id);
    const bySession = {}; // id -> { total, sections:{label:count}, mine }
    if (ids.length) {
      const { data: bk } = await db.from('bookings')
        .select('session_id,section,member_id,status')
        .in('session_id', ids)
        .in('status', ['booked', 'attended']);
      (bk || []).forEach(b => {
        const e = bySession[b.session_id] || (bySession[b.session_id] = { total: 0, sections: {}, mine: false });
        e.total++;
        if (b.section) e.sections[b.section] = (e.sections[b.section] || 0) + 1;
        if (user && b.member_id === user.id) e.mine = true;
      });
    }

    const out = sessions.map(s => {
      const e = bySession[s.id] || { total: 0, sections: {}, mine: false };
      const n = s.stations || 4;
      const spotsLeft = Math.max(0, s.capacity - e.total);
      const sections = stationLabels(n).map((label, i) => {
        const cap = sectionCap(s.capacity, i, n);
        const booked = e.sections[label] || 0;
        return { label, spots_left: Math.max(0, cap - booked), full: booked >= cap };
      });
      return {
        id: s.id,
        date_label: formatDate(s.session_date, s.start_time),
        session_date: s.session_date,
        start_time: s.start_time || null,
        location: s.location,
        capacity: s.capacity,
        stations: n,
        photo_url: s.photo_url || null,
        booked: e.total,
        spots_left: spotsLeft,
        sold_out: spotsLeft === 0 || s.status !== 'open',
        booked_by_me: e.mine,
        sections
      };
    });

    // Each recent photo stays tied to its own Sunday - nothing is overwritten.
    const recentPhotos = ((photoRes && photoRes.data) || []).map(p => ({
      session_date: p.session_date,
      date_label: formatDate(p.session_date, p.start_time),
      photo_url: p.photo_url
    }));

    res.status(200).json({
      sessions: out,
      recent_photos: recentPhotos,
      latest_photo: recentPhotos[0] ? recentPhotos[0].photo_url : null
    });
  } catch (e) {
    console.error('[/api/sessions]', e);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
};
