// GET /api/admin/merch-orders - admin only. Every t-shirt order: who bought,
// their name/email, size, amount, payment status, and whether it's been handed
// over yet. Newest first.
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    const { data: orders, error } = await db.from('merch_orders')
      .select('id, member_id, product, size, amount_aed, status, created_at, fulfilled_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const ids = [...new Set((orders || []).map(o => o.member_id).filter(Boolean))];
    const byMember = {};
    if (ids.length) {
      const { data: members } = await db.from('members').select('id, full_name, email').in('id', ids);
      (members || []).forEach(m => { byMember[m.id] = m; });
    }

    const list = (orders || []).map(o => {
      const m = byMember[o.member_id] || {};
      return {
        id: o.id,
        name: m.full_name || (m.email ? m.email.split('@')[0] : '—'),
        email: m.email || null,
        size: o.size,
        amount_aed: Number(o.amount_aed || 0),
        status: o.status,                       // paid | fulfilled | cancelled
        fulfilled: o.status === 'fulfilled',
        created_at: o.created_at
      };
    });

    const summary = {
      total: list.length,
      paid_not_fulfilled: list.filter(o => o.status === 'paid').length,
      fulfilled: list.filter(o => o.status === 'fulfilled').length,
      revenue_aed: list.filter(o => o.status !== 'cancelled').reduce((a, o) => a + o.amount_aed, 0),
      by_size: list.reduce((acc, o) => { if (o.status !== 'cancelled') acc[o.size] = (acc[o.size] || 0) + 1; return acc; }, {})
    };

    res.status(200).json({ orders: list, summary });
  } catch (e) {
    console.error('[/api/admin/merch-orders]', e);
    res.status(500).json({ error: 'Server error' });
  }
};
