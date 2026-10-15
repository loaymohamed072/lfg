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

    // Omar's ask: flag the first-timers and show the Instagram handle. A first-timer
    // is someone with no run check-in and no paid run before this run's date.
    const memberIds = Array.from(new Set((rows || []).map(r => r.member_id).filter(Boolean)));
    const igByMember = {}; const firstSeen = {};
    if (memberIds.length) {
      const [{ data: regs }, { data: att }] = await Promise.all([
        db.from('run_registrations').select('member_id,instagram_handle').in('member_id', memberIds),
        db.from('run_attendance').select('member_id,run_date').in('member_id', memberIds)
      ]);
      (regs || []).forEach(x => { if (x.member_id && x.instagram_handle && !igByMember[x.member_id]) igByMember[x.member_id] = String(x.instagram_handle).replace(/^@/, ''); });
      (att || []).forEach(x => { if (!firstSeen[x.member_id] || x.run_date < firstSeen[x.member_id]) firstSeen[x.member_id] = x.run_date; });
      (rows || []).forEach(x => { if (!firstSeen[x.member_id] || x.run_date < firstSeen[x.member_id]) firstSeen[x.member_id] = x.run_date; });
    }

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
        host: !!r.is_admin,
        instagram: igByMember[r.member_id] || null,
        first_timer: !r.is_admin && firstSeen[r.member_id] === r.run_date
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
