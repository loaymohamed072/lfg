// GET /api/admin/stats - owner dashboard data. Admin only.
// Staff admins (can_view_revenue=false) get the same payload with every money figure
// stripped server-side: all-time + 30d revenue, the revenue chart series, and per-member spend.
const { admin, getUser, isAdmin, canViewRevenue, ownerStats } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });
  try {
    const cvr = await canViewRevenue(db, user.id);
    const data = await ownerStats(db);
    if (!cvr) {
      if (data.totals) { delete data.totals.revenue; delete data.totals.revenue_30d; }
      data.revenue_series = [];
      data.latest_payments = [];
      (data.members || []).forEach(m => { delete m.spend; });
    }
    data.can_view_revenue = cvr;
    res.status(200).json(data);
  } catch (e) {
    console.error('[/api/admin/stats]', e);
    res.status(500).json({ error: 'Failed to load stats' });
  }
};
