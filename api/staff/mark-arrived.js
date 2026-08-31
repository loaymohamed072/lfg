// /api/staff/mark-arrived - the door's manual arrival tool. Gate link token OR
// admin/gate-staff JWT.
// Real gates always have someone with a dead phone, so staff need to put a person on
// the board by hand. Two methods, one feature, one file:
//
//   GET  ?q=<name>          find members not yet on tonight's board (id + name only)
//   POST { member_id }      mark that member arrived at tonight's run
//
// The write goes through the SAME SECURITY DEFINER RPC the QR self check-in uses
// (run_check_in_member), so a manual arrival is byte-identical to a scanned one:
// same run_type, same location, same Dubai date, and crucially the same window rule
// (opens 90 minutes before the run, closes 150 minutes after). Staff cannot invent
// attendance for a run that is not happening. The RPC returns its refusal as plain
// English, which is passed straight through to the phone.
//
// Attribution: run_attendance carries no author column of its own, so after the RPC
// inserts, the row is stamped with marked_by (see sql/2026-08-31_gate_staff.sql).
// A self-scan leaves it NULL. On the JWT path marked_by is the caller's own id; on
// the shared-link path the phone sends the volunteer picked on the gate page. That
// id is a LABEL, never a permission: it is checked against is_gate_staff and
// silently dropped if it doesn't belong to a flagged volunteer, so a forged id
// buys nothing and a stale one never blocks the door.
//
// NOT here: creating an account for a walk-in with no member record at all. That
// writes to auth, and who may mint accounts is the owner's call, not a volunteer's.
const { requireGateAccess } = require('../_lib');

function dubaiYMD(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireGateAccess(req, res);
  if (!gate) return;
  const { db, user } = gate;

  const runDate = dubaiYMD(new Date());

  try {
    // ---------- find someone ----------
    if (req.method === 'GET') {
      const q = String((req.query && req.query.q) || '').trim();
      // Two characters minimum, eight results maximum: enough to find the runner in
      // front of you, not enough to walk the member list off a borrowed phone.
      if (q.length < 2) return res.status(200).json({ results: [] });

      const [{ data: matches }, { data: already }] = await Promise.all([
        db.from('members').select('id, full_name').ilike('full_name', '%' + q + '%').limit(30),
        db.from('run_attendance').select('member_id').eq('run_date', runDate)
      ]);
      const onBoard = new Set((already || []).map(a => a.member_id));

      const results = (matches || [])
        .filter(m => m.full_name && !onBoard.has(m.id))
        .slice(0, 8)
        .map(m => ({ member_id: m.id, name: m.full_name }));   // name only, never email
      return res.status(200).json({ results });
    }

    // ---------- mark them in ----------
    const memberId = (req.body && req.body.member_id) || null;
    if (!memberId) return res.status(400).json({ error: 'Pick a person first.' });

    const { data: target } = await db.from('members').select('id, full_name').eq('id', memberId).maybeSingle();
    if (!target) return res.status(404).json({ error: 'No member with that id.' });

    const { data, error } = await db.rpc('run_check_in_member', { p_user_id: memberId });
    if (error) {
      console.error('[/api/staff/mark-arrived] rpc', error);
      return res.status(500).json({ error: 'Could not mark them in. Try again.' });
    }
    const result = data || { ok: false, error: 'Unknown' };
    if (!result.ok) return res.status(409).json({ error: result.error || 'Could not mark them in.' });

    // Stamp who did it, on fresh rows only - a runner who already scanned themselves
    // in keeps their self-scan. Best-effort: the attendance itself is what matters.
    // JWT path: the caller's own id. Token path: the volunteer the phone claims,
    // kept only if that id really is a flagged volunteer (label, not permission).
    let stampId = user ? user.id : null;
    if (!stampId && req.body && req.body.marked_by) {
      const { data: vol } = await db.from('members')
        .select('is_gate_staff').eq('id', String(req.body.marked_by)).maybeSingle();
      if (vol && vol.is_gate_staff) stampId = String(req.body.marked_by);
    }
    if (!result.already && stampId) {
      const { error: stampErr } = await db.from('run_attendance')
        .update({ marked_by: stampId })
        .eq('member_id', memberId).eq('run_date', runDate).is('marked_by', null);
      if (stampErr) console.warn('[/api/staff/mark-arrived] marked_by', stampErr.message);
    }

    return res.status(200).json({
      ok: true,
      already: !!result.already,
      member_id: memberId,
      name: target.full_name || 'Name not on file'
    });
  } catch (e) {
    console.error('[/api/staff/mark-arrived]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
