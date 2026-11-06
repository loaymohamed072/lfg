// POST /api/admin/set-capacity - owner adjusts a session's capacity. Admin only.
// Body: { session_id, capacity }
const { admin, getUser, isAdmin } = require('../_lib');
const { liveHolds, heldBySession } = require('../_friends');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const cap = parseInt(body.capacity, 10);
  if (!body.session_id || isNaN(cap) || cap < 4 || cap > 200) {
    return res.status(400).json({ error: 'Capacity must be 4–200' });
  }
  try {
    // Never set capacity below what's already booked, counting spots members hold for friends.
    const [{ count }, holds, { data: sess, error: sessErr }] = await Promise.all([
      db.from('bookings').select('id', { count: 'exact', head: true })
        .eq('session_id', body.session_id).in('status', ['booked', 'attended']),
      liveHolds(db, [body.session_id], { strict: true }),
      db.from('sessions').select('stations,capacity').eq('id', body.session_id).maybeSingle()
    ]);
    if (sessErr) throw new Error(sessErr.message);
    // Saving the number already there changes nothing (a hand-set 162 must not round to 156).
    if (sess && sess.capacity === cap) return res.status(200).json({ ok: true, capacity: cap });
    const held = (heldBySession(holds, Date.now())[body.session_id] || { total: 0 }).total;
    const taken = (count || 0) + held;
    if (cap < taken) {
      return res.status(409).json({ error: 'Already ' + (count || 0) + ' booked' + (held ? ' and ' + held + ' held for friends' : '') + '; capacity can\'t be lower' });
    }
    // Partners train in pairs, so the sessions trigger keeps capacity a multiple of
    // 2 x stations, rounding up. A typed number rounds DOWN instead (Loay, 4 Nov 2026: 150 on
    // 6 stations became 156; it should be 144, 24 a station). If that would leave someone
    // already in without a place, the typed number goes in: an even one stays as typed and
    // the stations split it in pairs (162 on 6: 28,28,28,26,26,26), an odd one rounds up.
    const step = 2 * Math.max((sess && sess.stations) || 4, 1);
    const down = Math.floor(cap / step) * step;
    const stored = down > 0 && down >= taken ? down : cap;
    // Set max_capacity to match so the manual value is a hard ceiling: the gradual
    // auto-bump (maybe_bump_capacity) can't raise capacity past what the admin chose.
    const { error } = await db.from('sessions').update({ capacity: stored, max_capacity: stored }).eq('id', body.session_id);
    if (error) throw new Error(error.message);
    res.status(200).json({ ok: true, capacity: stored });
  } catch (e) {
    console.error('[/api/admin/set-capacity]', e);
    res.status(500).json({ error: 'Update failed' });
  }
};
