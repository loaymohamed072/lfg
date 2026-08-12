// POST /api/push-unsubscribe - drop this device's subscription.
//
// Scoped to the caller's own rows. A member turning notifications off on their
// phone must not silence their laptop, so we match on endpoint, not member.
const { admin, getUser, safeError } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const endpoint = body && body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  try {
    const db = admin();
    await db.from('run_push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('member_id', user.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return safeError(res, '/api/push-unsubscribe', e, 'Could not turn notifications off.');
  }
};
