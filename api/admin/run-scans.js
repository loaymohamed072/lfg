// GET /api/admin/run-scans?run_date=YYYY-MM-DD - admin only.
// Who actually SCANNED IN at a run, split by whether they paid. This is the
// door view: run_attendance is the source of truth for attendance, not run_rsvps
// (an RSVP is an intention, a scan is a person standing in front of you).
//
// WHY THE MATCHING IS NOT JUST member_id:
// Members routinely hold two accounts - they sign up for a run with one email and
// later create an account with another (Google sign-in vs email link). On the
// 2026-07-22 run, 4 scanners had no payment under their own member_id, but 2 of
// them had paid under a second account with a different email. Flagging on
// member_id alone would have accused half the "unpaid" list of not paying while
// they were standing there having paid. So a scanner counts as paid if ANY of:
//   1. direct       - a paid run payment on their own member_id
//   2. linked       - a paid run payment by another member with the same
//                     normalised name or the same WhatsApp number
//   3. host         - they're an admin (comped)
// Anything less certain is reported with its reason so the owner can judge,
// rather than the UI asserting "didn't pay" as fact.
const { admin, getUser, isAdmin } = require('../_lib');

function dubaiYMD(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function advanceIfPast(dtStr) {
  if (!dtStr) return null;
  let t = new Date(dtStr); if (isNaN(t.getTime())) return null;
  const now = Date.now(); let guard = 0;
  while (t.getTime() + 3600000 < now && guard++ < 520) t = new Date(t.getTime() + 7 * 86400000);
  return t;
}
// Same normalisation the leads feed uses for its name fallback.
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normPhone = s => String(s || '').replace(/[^\d]/g, '').slice(-9); // last 9 digits: ignores +971 / 0 prefixes

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    // Which run are we looking at? Explicit param wins; otherwise the most recent
    // run that has scans today, else today's date.
    let runDate = (req.query && req.query.run_date) || null;
    if (!runDate) runDate = dubaiYMD(new Date());

    // Is this run a paid one? A free run has nothing to chase.
    let paidRunDate = null;
    const { data: cfg } = await db.from('event_config').select('run_paid, event_datetime').eq('id', 1).maybeSingle();
    if (cfg && cfg.run_paid && cfg.event_datetime) {
      const t = advanceIfPast(cfg.event_datetime);
      if (t) paidRunDate = dubaiYMD(t);
    }

    const [scanRes, payRes, memRes, regRes] = await Promise.all([
      db.from('run_attendance').select('member_id, checked_in_at, run_type, location').eq('run_date', runDate),
      db.from('payments').select('member_id, amount_aed, status, promo_code').eq('kind', 'run').eq('run_date', runDate),
      db.from('members').select('id, full_name, email, is_admin'),
      db.from('run_registrations').select('member_id, whatsapp_e164, first_name, last_name')
    ]);

    const scans = scanRes.data || [];
    if (!scans.length) {
      return res.status(200).json({
        run_date: runDate, paid_run: paidRunDate === runDate,
        scanned: [], unpaid: [], summary: { scanned: 0, paid: 0, unpaid: 0, paid_no_scan: 0, revenue_aed: 0 }
      });
    }

    const memById = {};
    (memRes.data || []).forEach(m => { memById[m.id] = m; });

    // WhatsApp per member (first row that carries a number), kept both raw for
    // display and normalised for matching.
    const phoneByMember = {}, rawPhoneByMember = {};
    (regRes.data || []).forEach(r => {
      if (r.member_id && r.whatsapp_e164 && !phoneByMember[r.member_id]) {
        phoneByMember[r.member_id] = normPhone(r.whatsapp_e164);
        rawPhoneByMember[r.member_id] = r.whatsapp_e164;
      }
    });

    // Everyone who actually paid for THIS run, indexed three ways.
    const paidIds = new Set(), paidNames = new Map(), paidPhones = new Map();
    let revenue = 0;
    const pendingIds = new Set();
    (payRes.data || []).forEach(p => {
      if (!p.member_id) return;
      if (p.status === 'paid') {
        paidIds.add(p.member_id);
        revenue += Number(p.amount_aed) || 0;
        const m = memById[p.member_id];
        const nm = normName(m && m.full_name);
        if (nm && nm.indexOf(' ') > -1) paidNames.set(nm, p.member_id);   // 2+ word names only
        const ph = phoneByMember[p.member_id];
        if (ph && ph.length >= 8) paidPhones.set(ph, p.member_id);
      } else if (p.status === 'pending') {
        pendingIds.add(p.member_id);
      }
    });

    // One row per person (a double scan is still one runner).
    const seen = new Set();
    const scanned = [];
    scans.forEach(s => {
      if (!s.member_id || seen.has(s.member_id)) return;
      seen.add(s.member_id);
      const m = memById[s.member_id] || {};
      const nm = normName(m.full_name);
      const ph = phoneByMember[s.member_id];

      let paid = false, via = null, linkedTo = null;
      if (paidIds.has(s.member_id)) { paid = true; via = 'direct'; }
      else if (nm && paidNames.has(nm)) { paid = true; via = 'linked_account'; linkedTo = paidNames.get(nm); }
      else if (ph && ph.length >= 8 && paidPhones.has(ph)) { paid = true; via = 'linked_account'; linkedTo = paidPhones.get(ph); }
      else if (m.is_admin) { paid = true; via = 'host'; }

      const linkedMem = linkedTo ? memById[linkedTo] : null;
      scanned.push({
        member_id: s.member_id,
        name: m.full_name || m.email || '—',
        email: m.email || null,
        whatsapp: rawPhoneByMember[s.member_id] || null,
        checked_in_at: s.checked_in_at,
        location: s.location || null,
        paid, paid_via: via,
        linked_email: linkedMem ? linkedMem.email : null,
        started_checkout: !paid && pendingIds.has(s.member_id)
      });
    });

    scanned.sort((a, b) => Date.parse(a.checked_in_at || 0) - Date.parse(b.checked_in_at || 0));
    const unpaid = scanned.filter(s => !s.paid);

    // Paid but never scanned - the other half of the reconciliation.
    const scannedIds = new Set(scanned.map(s => s.member_id));
    const paidNoScan = [...paidIds].filter(id => !scannedIds.has(id)).map(id => {
      const m = memById[id] || {};
      return { member_id: id, name: m.full_name || m.email || '—', email: m.email || null };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return res.status(200).json({
      run_date: runDate,
      paid_run: paidRunDate === runDate,
      scanned,
      unpaid,
      paid_no_scan: paidNoScan,
      summary: {
        scanned: scanned.length,
        paid: scanned.length - unpaid.length,
        unpaid: unpaid.length,
        paid_no_scan: paidNoScan.length,
        revenue_aed: revenue
      }
    });
  } catch (e) {
    console.error('[/api/admin/run-scans]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
