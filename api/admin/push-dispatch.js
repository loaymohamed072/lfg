// /api/admin/push-dispatch - fires scheduled announcements whose time has come.
//
// Called every minute by Vercel Cron (bearer CRON_SECRET / LFG_CRON_TOKEN), and by
// an admin manually via the same route. The common case is "nothing due", which is
// one indexed query and an immediate return.
//
// Claiming is handled inside runCampaign with a conditional status update, so two
// overlapping ticks cannot double-send the same announcement.
const { admin, requireAdminOrCron, safeError } = require('../_lib');
const { runCampaign } = require('../_push');

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. requireAdminOrCron only
// knows LFG_CRON_TOKEN, so check the Vercel-managed secret here rather than widening
// the shared helper for every endpoint that uses it.
function isVercelCron(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return Boolean(token && process.env.CRON_SECRET && token === process.env.CRON_SECRET);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = isVercelCron(req) ? { db: admin(), mode: 'cron' } : await requireAdminOrCron(req, res);
  if (!ctx) return;
  const { db } = ctx;

  try {
    const { data: due, error } = await db
      .from('run_push_campaigns')
      .select('id,title,body,url')
      .eq('status', 'scheduled')
      .not('send_at', 'is', null)
      .lte('send_at', new Date().toISOString())
      .order('send_at', { ascending: true })
      .limit(5);
    if (error) throw error;

    if (!due || !due.length) return res.status(200).json({ ok: true, ran: 0 });

    const results = [];
    for (const c of due) {
      try {
        const done = await runCampaign(db, c);
        if (done) results.push({ id: c.id, sent: done.sent_count, failed: done.failed_count });
      } catch (e) {
        console.error('[/api/admin/push-dispatch] campaign', c.id, e && e.message);
        results.push({ id: c.id, error: true });
      }
    }

    return res.status(200).json({ ok: true, ran: results.length, results });
  } catch (e) {
    return safeError(res, '/api/admin/push-dispatch', e, 'Dispatch failed.');
  }
};
