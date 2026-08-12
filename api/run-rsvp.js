// Run RSVP - logged-in members say whether they're coming to the next run.
//
//   POST /api/run-rsvp   (auth)   body: { run_date:'YYYY-MM-DD', run_type?, attending:bool }
//                                  → upserts the member's RSVP, returns fresh count
//   GET  /api/run-rsvp?run_date=YYYY-MM-DD  (auth optional)
//                                  → { count, first_names[], my_status }  for that run
//
// RSVP is intent/headcount before the run; it's separate from the QR run check-in
// (run_attendance) which records who actually showed up. Service-role only - the
// run_rsvps table has RLS on with no policies.
const { admin, getUser, ensureMember } = require('./_lib');

function validRunDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() < now - 2 * 86400000) return null;   // not in the past (small grace)
  if (d.getTime() > now + 60 * 86400000) return null;  // not absurdly far out
  return s;
}

module.exports = async (req, res) => {
  const db = admin();

  if (req.method === 'GET') {
    const runDate = validRunDate(req.query && req.query.run_date);
    if (!runDate) return res.status(400).json({ error: 'Bad run_date' });
    const { data: rows, error } = await db.from('run_rsvps')
      .select('member_id, members(full_name)')
      .eq('run_date', runDate).eq('attending', true);
    if (error) return res.status(500).json({ error: error.message });
    const count = (rows || []).length;
    const first_names = (rows || [])
      .map(r => ((r.members && r.members.full_name) || '').trim().split(/\s+/)[0])
      .filter(Boolean)
      .slice(0, 40);

    let my_status = null;
    try {
      const user = await getUser(req);
      if (user) {
        const { data: mine } = await db.from('run_rsvps')
          .select('attending').eq('member_id', user.id).eq('run_date', runDate).maybeSingle();
        if (mine) my_status = mine.attending ? 'yes' : 'no';
      }
    } catch (e) { /* anonymous viewer - count only */ }

    return res.status(200).json({ count, first_names, my_status });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  const runDate = validRunDate(body.run_date);
  if (!runDate) return res.status(400).json({ error: 'Bad run_date' });
  const attending = body.attending !== false; // default true
  const runType = (typeof body.run_type === 'string' && body.run_type.length <= 20) ? body.run_type : null;

  try {
    await ensureMember(db, user);
    const { error } = await db.from('run_rsvps').upsert(
      { member_id: user.id, run_date: runDate, run_type: runType, attending, updated_at: new Date().toISOString() },
      { onConflict: 'member_id,run_date' }
    );
    if (error) throw new Error(error.message);
    const { count } = await db.from('run_rsvps')
      .select('id', { count: 'exact', head: true })
      .eq('run_date', runDate).eq('attending', true);
    return res.status(200).json({ ok: true, attending, count: count || 0 });
  } catch (e) {
    console.error('[/api/run-rsvp]', e);
    return res.status(500).json({ error: 'Could not save RSVP' });
  }
};
