// GET /api/admin/export - member list as CSV. Admin only.
// Fetched with the Bearer token from the dashboard, then downloaded client-side.
// Staff admins (can_view_revenue=false) get the same CSV with the Spend column removed.
const { admin, getUser, isAdmin, canViewRevenue, ownerStats } = require('../_lib');

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    const cvr = await canViewRevenue(db, user.id);
    const { members } = await ownerStats(db);
    const header = ['Email', 'Name', 'Joined']
      .concat(cvr ? ['Total Spend (AED)'] : [])
      .concat(['Credits Left', 'Booked', 'Attended', 'Last Activity', 'Lapsed (30d)']);
    const rows = members.map(m => [m.email, m.name, m.joined]
      .concat(cvr ? [m.spend] : [])
      .concat([m.credits, m.booked, m.attended, m.last_activity, m.lapsed ? 'Yes' : 'No']));
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.status(200).send(csv);
  } catch (e) {
    console.error('[/api/admin/export]', e);
    res.status(500).json({ error: 'Export failed' });
  }
};
