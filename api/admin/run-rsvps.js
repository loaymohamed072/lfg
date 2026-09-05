// GET /api/admin/run-rsvps?run_date=YYYY-MM-DD - admin only.
// The owner's roster for a run: who's coming + where they're from (nationality) + WhatsApp.
// Omit run_date to get every upcoming RSVP grouped by date.
//
// PAID RUNS: when the current run is flagged paid (event_config.run_paid), the roster shows
// only people who actually PAID (run_rsvps.paid = true), PLUS admins/hosts (is_admin) who
// attend without paying. RSVP'd-but-didn't-pay and abandoned-checkout rows are hidden.
// Free runs behave as before (everyone attending).
const { admin, getUser, isAdmin } = require('../_lib');

function advanceIfPast(dtStr) {
  if (!dtStr) return null;
  let t = new Date(dtStr); if (isNaN(t.getTime())) return null;
  const now = Date.now(); let guard = 0;
  // 1-hour grace (matches the pay page): keep a run "current" until 1h past its start so
  // late-but-same-night payments resolve to the run that just happened, not next week's.
  while (t.getTime() + 3600000 < now && guard++ < 520) t = new Date(t.getTime() + 7 * 86400000);
  return t;
}
function dubaiYMD(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const runDate = req.query && req.query.run_date;
  try {
    // Is the (upcoming) run a paid one? If so, which run_date is paid.
    let paidRunDate = null;
    const { data: cfg } = await db.from('event_config').select('run_paid, event_datetime').eq('id', 1).maybeSingle();
    if (cfg && cfg.run_paid && cfg.event_datetime) {
      const t = advanceIfPast(cfg.event_datetime);
      if (t) paidRunDate = dubaiYMD(t);
    }

    let q = db.from('run_rsvps')
      .select('member_id, attending, run_date, paid, members(full_name,email,is_admin)')
      .eq('attending', true)
      .order('run_date', { ascending: true });
    if (runDate) q = q.eq('run_date', runDate);
    // Upcoming only, filtered HERE and not in the browser. PostgREST caps every
    // response at 1000 rows, and this query sorts oldest-first, so once the table
    // passed 1000 attending rows (26 Aug 2026) the newest runs — the only ones the
    // dashboard shows — were the rows being dropped. The roster card then saw an
    // empty list and hid itself. The caller already discarded past runs, so this
    // filter changes nothing except which rows survive the cap.
    else q = q.gte('run_date', dubaiYMD(new Date()));
    const { data: rsvps, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Money source of truth: who has an actual PAID run payment for the paid run. Reading the
    // payments table (not just run_rsvps.paid) makes the roster correct even if a webhook
    // rsvp-write lagged. run_rsvps.paid is treated as a secondary signal.
    const paidPayerIds = new Set();
    if (paidRunDate) {
      const { data: paidPayments } = await db.from('payments')
        .select('member_id').eq('kind', 'run').eq('status', 'paid').eq('run_date', paidRunDate);
      (paidPayments || []).forEach(p => { if (p.member_id) paidPayerIds.add(p.member_id); });
    }
    const hasPaid = (r) => r.paid === true || paidPayerIds.has(r.member_id);

    // For a paid run, keep only paid people + admins/hosts. Count who we hid (unpaid non-hosts)
    // so the owner still knows how many RSVP'd without paying.
    let unpaidHidden = 0;
    const kept = (rsvps || []).filter(r => {
      if (paidRunDate && r.run_date === paidRunDate) {
        const host = !!(r.members && r.members.is_admin);
        if (hasPaid(r) || host) return true;
        unpaidHidden++;
        return false;
      }
      return true; // free run → everyone attending
    });

    // Enrich with nationality + WhatsApp from the member's run registration.
    const memberIds = [...new Set(kept.map(r => r.member_id))];
    const regByMember = {};
    if (memberIds.length) {
      const { data: regs } = await db.from('run_registrations')
        .select('member_id,nationality,whatsapp_e164,first_name,last_name,level')
        .in('member_id', memberIds);
      (regs || []).forEach(x => { if (x.member_id) regByMember[x.member_id] = x; });
    }

    const list = kept.map(r => {
      const reg = regByMember[r.member_id] || {};
      const name = (r.members && r.members.full_name)
        || ((reg.first_name || '') + ' ' + (reg.last_name || '')).trim()
        || (r.members && r.members.email) || '—';
      const isHost = !!(r.members && r.members.is_admin);
      const paid = hasPaid(r);
      return {
        run_date: r.run_date,
        member_id: r.member_id || null,
        email: (r.members && r.members.email) || null,
        name: name,
        nationality: reg.nationality || null,
        whatsapp: reg.whatsapp_e164 || null,
        level: reg.level || null,
        paid: paid,
        host: isHost && !paid // host attending without paying (comped)
      };
    });

    return res.status(200).json({
      rsvps: list,
      total: list.length,
      paid_run: !!paidRunDate,
      unpaid_hidden: unpaidHidden
    });
  } catch (e) {
    console.error('[/api/admin/run-rsvps]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
