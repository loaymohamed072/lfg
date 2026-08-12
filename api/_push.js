// Web push sender for the run-club PWA (www.lfgdubai.com).
//
// Deliberately separate from coaching-app's push lane: a push endpoint belongs to
// the origin whose service worker minted it, and our payloads carry run-club paths.
// Same VAPID keypair (one application-server identity for LFG), separate table.
//
// Missing VAPID env degrades to a no-op with a clear reason, never a crash - a
// half-configured deploy should not 500 the admin page.
const webpush = require('web-push');

let configured = null; // null = not attempted, true/false = result

function configurePush() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { configured = false; return false; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@lfgdubai.com', pub, priv);
  configured = true;
  return true;
}

function publicKey() { return process.env.VAPID_PUBLIC_KEY || null; }

// Send one payload to every subscribed device.
//
// Returns { sent, failed, pruned, skipped }. Never throws: one dead endpoint must
// not abort an announcement going to 600 others. Endpoints the push service has
// retired (404/410) are deleted so the list stays honest about its real reach.
async function sendToAll(db, payload) {
  if (!configurePush()) return { sent: 0, failed: 0, pruned: 0, skipped: true };

  const { data: subs, error } = await db
    .from('run_push_subscriptions')
    .select('id, endpoint, p256dh, auth');
  if (error) throw error;
  if (!subs || !subs.length) return { sent: 0, failed: 0, pruned: 0, skipped: false };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/account',
    tag: payload.tag || 'lfg-announce'
  });

  let sent = 0, failed = 0;
  const dead = [];
  const alive = [];

  // Chunked so a big list does not open 600 sockets at once.
  const CHUNK = 50;
  for (let i = 0; i < subs.length; i += CHUNK) {
    const batch = subs.slice(i, i + CHUNK);
    await Promise.all(batch.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 24 * 3600 } // a run announcement is stale after a day
        );
        sent++;
        alive.push(s.id);
      } catch (e) {
        const code = e && e.statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else failed++;
      }
    }));
  }

  if (dead.length) {
    await db.from('run_push_subscriptions').delete().in('id', dead);
  }
  if (alive.length) {
    await db.from('run_push_subscriptions')
      .update({ last_used_at: new Date().toISOString() })
      .in('id', alive);
  }

  return { sent, failed, pruned: dead.length, skipped: false };
}

// Run one campaign row end to end and write the outcome back.
//
// The claim is a conditional update on status, so two dispatchers firing in the
// same minute cannot both send the same announcement: whoever flips 'scheduled'
// to 'sending' first owns it, the other gets zero rows back and walks away.
async function runCampaign(db, campaign) {
  const { data: claimed } = await db
    .from('run_push_campaigns')
    .update({ status: 'sending' })
    .eq('id', campaign.id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (!claimed) return null; // someone else took it

  try {
    const r = await sendToAll(db, campaign);
    const { data } = await db.from('run_push_campaigns').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_count: r.sent,
      failed_count: r.failed,
      error: r.skipped ? 'Push keys are not configured on this deploy' : null
    }).eq('id', campaign.id).select().maybeSingle();
    return data;
  } catch (e) {
    await db.from('run_push_campaigns').update({
      status: 'failed',
      error: String((e && e.message) || e).slice(0, 400)
    }).eq('id', campaign.id);
    throw e;
  }
}

module.exports = { configurePush, publicKey, sendToAll, runCampaign };
