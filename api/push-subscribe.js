// POST /api/push-subscribe - store this device's push subscription.
//
// Two callers:
//   1. /account, with a Bearer token - the member just tapped "Turn on notifications".
//   2. The service worker's pushsubscriptionchange handler, with NO token, because a
//      service worker has no Supabase session. That path sends old_endpoint and can
//      only rotate a row it already holds the endpoint for. Endpoints are long
//      unguessable secrets issued by the push service, so knowing one is the proof
//      of ownership; the rotation never changes member_id.
const { admin, getUser, ensureMember, safeError } = require('./_lib');

function readSub(body) {
  const s = body && (body.subscription || body);
  if (!s || typeof s.endpoint !== 'string' || !s.endpoint) return null;
  const keys = s.keys || {};
  if (!keys.p256dh || !keys.auth) return null;
  if (!/^https:\/\//.test(s.endpoint)) return null;
  return { endpoint: s.endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth) };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }

  const sub = readSub(body);
  if (!sub) return res.status(400).json({ error: 'Invalid subscription' });

  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const db = admin();

  try {
    const user = await getUser(req);

    // Path 2: service-worker rotation. No session, so the old endpoint identifies
    // the row. If we cannot find it, there is nothing to rotate - say so quietly.
    if (!user) {
      const oldEndpoint = body && body.old_endpoint;
      if (!oldEndpoint) return res.status(401).json({ error: 'Not authenticated' });
      const { data: existing } = await db
        .from('run_push_subscriptions')
        .select('id')
        .eq('endpoint', oldEndpoint)
        .maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Unknown subscription' });
      await db.from('run_push_subscriptions').update({
        endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth,
        user_agent: ua, last_used_at: new Date().toISOString()
      }).eq('id', existing.id);
      return res.status(200).json({ ok: true, rotated: true });
    }

    // Path 1: a signed-in member on /account.
    await ensureMember(db, user);
    const { error } = await db.from('run_push_subscriptions').upsert({
      member_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: ua,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    return safeError(res, '/api/push-subscribe', e, 'Could not save your notification settings.');
  }
};
