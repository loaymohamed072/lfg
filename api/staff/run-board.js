// GET /api/staff/run-board - the door board. Gate link token OR admin/gate-staff JWT.
//
// This is the deliberately NARROW twin of /api/admin/run-scans. A ticket master at
// the gate needs four things and nothing else: who is in, when they arrived, whether
// they paid, and which run this is. So this endpoint returns exactly that and strips
// everything else SERVER-SIDE, before it ever reaches the phone:
//   no email, no WhatsApp number, no revenue_aed, no promo codes,
//   no "paid but never scanned" roster, no linked-account emails.
// A door volunteer's network tab is as blind as their screen.
//
// Always today's run in Dubai - no run_date parameter. The door only ever cares about
// tonight, and not accepting one means a volunteer cannot page back through the
// attendance history of every past run.
//
// Paid/unpaid uses the shared resolver in api/_run-pay.js, the same fuzzy rule the
// admin console uses (a runner who paid on a second account is paid here too), so the
// two boards can never contradict each other in front of a person standing at the gate.
const { requireGateAccess } = require('../_lib');
const { buildRunPaidIndex } = require('../_run-pay');

function dubaiYMD(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// event_config holds one weekly run datetime; walk it forward to the current week.
function advanceIfPast(dtStr) {
  if (!dtStr) return null;
  let t = new Date(dtStr); if (isNaN(t.getTime())) return null;
  const now = Date.now(); let guard = 0;
  while (t.getTime() + 3600000 < now && guard++ < 520) t = new Date(t.getTime() + 7 * 86400000);
  return t;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const gate = await requireGateAccess(req, res);
  if (!gate) return;
  const db = gate.db;

  try {
    const runDate = dubaiYMD(new Date());

    // Is tonight a paid run? On a free run "unpaid" is noise, so the board hides it.
    // The same read also fetches the door-team roster: the shared gate link carries
    // no identity, so the phone shows a "who's on the door tonight?" picker built
    // from the flagged volunteers. First names only - this list rides on every
    // board response, so it leaks nothing a door volunteer doesn't already know.
    let paidRun = false;
    const [{ data: cfg }, { data: staffRows }] = await Promise.all([
      db.from('event_config').select('run_paid, event_datetime').eq('id', 1).maybeSingle(),
      db.from('members').select('id, full_name').eq('is_gate_staff', true)
    ]);
    if (cfg && cfg.run_paid && cfg.event_datetime) {
      const t = advanceIfPast(cfg.event_datetime);
      if (t) paidRun = dubaiYMD(t) === runDate;
    }
    const staff = (staffRows || [])
      .filter(s => s.full_name)
      .map(s => ({ id: s.id, name: String(s.full_name).trim().split(/\s+/)[0] }));

    const { data: scans } = await db.from('run_attendance')
      .select('member_id, checked_in_at, run_type, location, marked_by')
      .eq('run_date', runDate);

    if (!scans || !scans.length) {
      return res.status(200).json({
        run_date: runDate, run_type: null, location: null, paid_run: paidRun,
        staff, checked_in: [], summary: { checked_in: 0, unpaid: 0 }
      });
    }

    const paidIndex = await buildRunPaidIndex(db, runDate);

    // One row per person - a double scan is still one runner.
    const seen = new Set();
    const checkedIn = [];
    scans.forEach(s => {
      if (!s.member_id || seen.has(s.member_id)) return;
      seen.add(s.member_id);
      const m = paidIndex.members[s.member_id] || {};
      checkedIn.push({
        member_id: s.member_id,
        // Name only. Falling back to the email (what the admin board does) would
        // leak an address onto a volunteer's phone, so an unnamed member stays unnamed.
        name: m.full_name || 'Name not on file',
        checked_in_at: s.checked_in_at,
        paid: paidIndex.isPaid(s.member_id),
        manual: !!s.marked_by
      });
    });

    // Newest first: the person who just walked through the gate is at the top.
    checkedIn.sort((a, b) => Date.parse(b.checked_in_at || 0) - Date.parse(a.checked_in_at || 0));

    return res.status(200).json({
      run_date: runDate,
      run_type: scans[0].run_type || null,
      location: scans[0].location || null,
      paid_run: paidRun,
      staff,
      checked_in: checkedIn,
      summary: {
        checked_in: checkedIn.length,
        unpaid: checkedIn.filter(p => !p.paid).length
      }
    });
  } catch (e) {
    console.error('[/api/staff/run-board]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
