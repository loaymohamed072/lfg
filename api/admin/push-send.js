// /api/admin/push-send - the announcement composer's backend. Admin only.
//
// GET                              -> subscriber count + recent campaigns
// POST { title, body, url?, send_at? }
//        send_at omitted/null      -> send right now
//        send_at ISO string        -> queue it; /api/admin/push-dispatch fires it
// POST { action:'cancel', id }     -> cancel a still-scheduled announcement
const { requireAdmin, safeError } = require('../_lib');
const { runCampaign } = require('../_push');

const MAX_TITLE = 60;   // lockscreens truncate past roughly this
const MAX_BODY = 180;

// The service worker opens whatever url the payload carries. Restricting it to our
// own site keeps a compromised admin session from turning announcements into a
// phishing channel, and stops a typo shipping a dead link to every member.
function cleanUrl(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (v.startsWith('/')) return v.slice(0, 300);
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return null;
    if (!/(^|\.)lfgdubai\.com$/.test(u.hostname)) return null;
    return u.href.slice(0, 300);
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { db, user } = ctx;

  try {
    if (req.method === 'GET') {
      const [{ count }, { data: campaigns }] = await Promise.all([
        db.from('run_push_subscriptions').select('id', { count: 'exact', head: true }),
        db.from('run_push_campaigns')
          .select('id,title,body,url,send_at,status,sent_at,sent_count,failed_count,error,created_by_email,created_at')
          .order('created_at', { ascending: false })
          .limit(25)
      ]);
      return res.status(200).json({
        subscribers: count || 0,
        push_configured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        campaigns: campaigns || []
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    if (body.action === 'cancel') {
      if (!body.id) return res.status(400).json({ error: 'Missing id' });
      const { data } = await db.from('run_push_campaigns')
        .update({ status: 'cancelled' })
        .eq('id', body.id)
        .eq('status', 'scheduled')   // sent and sending are past the point of no return
        .select()
        .maybeSingle();
      if (!data) return res.status(409).json({ error: 'That one already went out.' });
      return res.status(200).json({ ok: true, campaign: data });
    }

    const title = String(body.title || '').trim();
    const message = String(body.body || body.message || '').trim();
    if (!title) return res.status(400).json({ error: 'Add a title.' });
    if (!message) return res.status(400).json({ error: 'Add a message.' });
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `Title is over ${MAX_TITLE} characters.` });
    if (message.length > MAX_BODY) return res.status(400).json({ error: `Message is over ${MAX_BODY} characters.` });

    let sendAt = null;
    if (body.send_at) {
      const d = new Date(body.send_at);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'That date and time did not parse.' });
      // A minute of slack so "schedule for 8:00" typed at 7:59:58 is not rejected.
      if (d.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'That time is in the past.' });
      sendAt = d.toISOString();
    }

    const { data: campaign, error } = await db.from('run_push_campaigns').insert({
      title,
      body: message,
      url: cleanUrl(body.url),
      send_at: sendAt,
      status: 'scheduled',
      created_by: user.id,
      created_by_email: user.email || null
    }).select().maybeSingle();
    if (error) throw error;

    // No send_at means now: run it inline so the admin sees the real count instead
    // of waiting for the next dispatcher tick.
    if (!sendAt) {
      const done = await runCampaign(db, campaign);
      return res.status(200).json({ ok: true, campaign: done || campaign, sent_now: true });
    }

    return res.status(200).json({ ok: true, campaign, sent_now: false });
  } catch (e) {
    return safeError(res, '/api/admin/push-send', e, 'Could not send that announcement.');
  }
};
