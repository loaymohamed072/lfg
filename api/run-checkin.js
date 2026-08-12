// POST /api/run-checkin - member self check-in for a Wednesday/Saturday run via QR.
// Auth required. The "is there a run today + are we inside the window" logic lives
// inside the SECURITY DEFINER run_check_in_member() RPC, so anon can't bypass it.
const { admin, getUser, ensureMember } = require('./_lib');
const { memberPaidForRun } = require('./_run-pay');

function dubaiYMD(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated', need_signin: true });

  try {
    const db = admin();
    await ensureMember(db, user);
    const { data, error } = await db.rpc('run_check_in_member', { p_user_id: user.id });
    if (error) return res.status(500).json({ error: error.message });
    const result = data || { ok: false, error: 'Unknown' };

    // They're checked in regardless (they showed up). On a PAID run, tell them if
    // we don't have their payment yet, so they can settle on the spot rather than
    // waiting to be chased. Never blocks the check-in; a lookup failure just omits
    // the nudge. Same paid-or-not rule as the admin board (api/_run-pay.js).
    if (result.ok) {
      try {
        const { data: cfg } = await db.from('event_config').select('run_paid, run_price_aed').eq('id', 1).maybeSingle();
        if (cfg && cfg.run_paid) {
          const runDate = dubaiYMD(new Date());
          const { paid } = await memberPaidForRun(db, user.id, runDate);
          result.owes = !paid;
          if (!paid) {
            result.price_aed = Number(cfg.run_price_aed) || 30;
            result.pay_url = '/track';
          }
        }
      } catch (e) { /* nudge is best-effort - never fail a check-in over it */ }
    }

    return res.status(200).json(result);
  } catch (e) {
    console.error('[/api/run-checkin]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
