// POST /api/admin/set-capacity - owner adjusts a session's capacity. Admin only.
// Body: { session_id, capacity }
const { admin, getUser, isAdmin } = require('../_lib');

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
    // Never set capacity below what's already booked.
    const { count } = await db.from('bookings').select('id', { count: 'exact', head: true })
      .eq('session_id', body.session_id).in('status', ['booked', 'attended']);
    if (cap < (count || 0)) return res.status(409).json({ error: 'Already ' + count + ' booked; capacity can\'t be lower' });
    // Set max_capacity to match so the manual value is a hard ceiling: the gradual
    // auto-bump (maybe_bump_capacity) can't raise capacity past what the admin chose.
    const { error } = await db.from('sessions').update({ capacity: cap, max_capacity: cap }).eq('id', body.session_id);
    if (error) throw new Error(error.message);
    res.status(200).json({ ok: true, capacity: cap });
  } catch (e) {
    console.error('[/api/admin/set-capacity]', e);
    res.status(500).json({ error: 'Update failed' });
  }
};
