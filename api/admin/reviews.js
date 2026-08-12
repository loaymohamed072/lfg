// GET  /api/admin/reviews          - admin only. Every review, newest first.
// POST /api/admin/reviews          - { id, action: 'approve' | 'reject' | 'pending' }
//
// Reviews arrive from the public form at status='pending' and stay invisible
// until someone approves them here. Three real ones sat unseen from June to
// July because this screen did not exist.
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  if (req.method === 'POST') {
    const body = req.body || {};
    const id = String(body.id || '');
    const action = String(body.action || '');
    if (!id) return res.status(400).json({ error: 'Missing review id' });
    const status = { approve: 'approved', reject: 'rejected', pending: 'pending' }[action];
    if (!status) return res.status(400).json({ error: 'Unknown action' });

    const patch = { status, approved_at: status === 'approved' ? new Date().toISOString() : null };
    const { error } = await db.from('reviews').update(patch).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, status });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await db
      .from('reviews')
      .select('id, rating, name, email, comment, status, created_at, approved_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const reviews = data || [];
    const counts = { pending: 0, approved: 0, rejected: 0 };
    reviews.forEach((r) => { if (counts[r.status] != null) counts[r.status]++; });

    return res.status(200).json({ ok: true, reviews, counts });
  } catch (e) {
    console.error('[/api/admin/reviews]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
