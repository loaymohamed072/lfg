// GET /api/admin/paid-runs - admin only. The paid-run ledger: who paid which run on which
// date, grouped by run, with revenue + how many actually checked in. Reads v_paid_runs
// (payment joined to member + best registration + check-in), so it's the money source of truth.
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    const { data: rows, error } = await db.from('v_paid_runs')
      .select('member_id, run_date, amount_aed, full_name, member_email, whatsapp_e164, nationality, level, checked_in, checked_in_at, is_admin')
      .order('run_date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Group by run date, newest run first; payers sorted by name within each run.
    const byDate = {};
    let grandRevenue = 0, grandPaid = 0;
    (rows || []).forEach(r => {
      const g = byDate[r.run_date] || (byDate[r.run_date] = { run_date: r.run_date, count: 0, revenue: 0, checked_in: 0, no_show: 0, payers: [] });
      const amt = Number(r.amount_aed) || 0;
      g.count++; g.revenue += amt;
      if (r.checked_in) g.checked_in++; else g.no_show++;
      grandPaid++; grandRevenue += amt;
      g.payers.push({
        member_id: r.member_id,
        name: r.full_name || r.member_email || '—',
        email: r.member_email || null,
        whatsapp: r.whatsapp_e164 || null,
        nationality: r.nationality || null,
        level: r.level || null,
        amount_aed: amt,
        checked_in: !!r.checked_in,
        checked_in_at: r.checked_in_at || null,
        host: !!r.is_admin
      });
    });

    const runs = Object.values(byDate).sort((a, b) => (a.run_date < b.run_date ? 1 : -1));
    runs.forEach(g => g.payers.sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase())));

    return res.status(200).json({
      runs,
      totals: { runs: runs.length, paid: grandPaid, revenue_aed: grandRevenue }
    });
  } catch (e) {
    console.error('[/api/admin/paid-runs]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
