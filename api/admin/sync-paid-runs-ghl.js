// POST /api/admin/sync-paid-runs-ghl?limit=25&offset=0 - admin only.
// One-time (repeatable) backfill: pushes existing paid-run payers into GHL as hot, paying
// leads via ghl.onPaidRun. Needed because runs that were paid before the onPaidRun hook
// existed never reached the CRM. Idempotent (GHL upserts dedupe by email) and honors
// GHL_DRY_RUN / GHL_DISABLED, so it's safe to run repeatedly. Batched to dodge timeouts:
// call with increasing offset until { remaining: 0 }.
const { admin, getUser, isAdmin } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const q = req.query || {};
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 50);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);

  try {
    const ghl = require('../_ghl');
    if (!ghl.isEnabled()) return res.status(200).json({ ok: true, skipped: 'ghl-disabled', dry_run: ghl.isDryRun() });

    // One entry per payer (email), with their total run spend as the opp value.
    const { data: rows, error } = await db.from('v_paid_runs')
      .select('member_email, full_name, whatsapp_e164, amount_aed, is_admin');
    if (error) return res.status(500).json({ error: error.message });

    const byEmail = {};
    (rows || []).forEach(r => {
      if (!r.member_email || r.is_admin) return; // skip hosts/admins
      const k = r.member_email.toLowerCase();
      const e = byEmail[k] || (byEmail[k] = { email: r.member_email, name: r.full_name || '', whatsapp: r.whatsapp_e164 || null, aed: 0 });
      e.aed += Number(r.amount_aed) || 0;
      if (!e.whatsapp && r.whatsapp_e164) e.whatsapp = r.whatsapp_e164;
    });

    const people = Object.values(byEmail).sort((a, b) => a.email.localeCompare(b.email));
    const batch = people.slice(offset, offset + limit);

    for (const p of batch) {
      const [first, ...rest] = (p.name || '').split(' ');
      await ghl.onPaidRun({
        email: p.email,
        firstName: first || undefined,
        lastName: rest.length ? rest.join(' ') : undefined,
        whatsapp_e164: p.whatsapp || undefined,
        amountAed: p.aed
      });
    }

    const done = offset + batch.length;
    return res.status(200).json({
      ok: true,
      dry_run: ghl.isDryRun(),
      total_payers: people.length,
      processed_this_call: batch.length,
      next_offset: done,
      remaining: Math.max(people.length - done, 0)
    });
  } catch (e) {
    console.error('[/api/admin/sync-paid-runs-ghl]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
