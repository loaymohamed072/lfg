// GET  /api/admin/reconcile-payments   → list stuck payments (status='pending' > 5 min old)
// POST /api/admin/reconcile-payments   → for each stuck payment, query Stripe and replay
//                                        fulfilment if Stripe says it was paid.
//
// Admin-only. Safe to call repeatedly - the underlying fulfilment is idempotent.
const Stripe = require('stripe');
const { admin, getUser, isAdmin, canViewRevenue, fulfillCheckoutSession } = require('../_lib');

const STUCK_MINUTES = 5; // Don't touch payments newer than this - webhook may still arrive normally.

module.exports = async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });
  // This panel lists payment amounts, so it's revenue-gated. Staff admins are blocked outright.
  if (!(await canViewRevenue(db, user.id))) return res.status(403).json({ error: 'Not authorised' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60 * 1000).toISOString();

  try {
    const { data: stuck, error } = await db.from('payments')
      .select('id,member_id,kind,amount_aed,stripe_session_id,created_at,promo_code')
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    if (req.method === 'GET') {
      // Attach who the checkout belongs to so the owner can follow up by email.
      const ids = [...new Set((stuck || []).map(p => p.member_id).filter(Boolean))];
      const byMember = {};
      if (ids.length) {
        const { data: ms } = await db.from('members').select('id,full_name,email').in('id', ids);
        (ms || []).forEach(m => { byMember[m.id] = m; });
      }
      // Read-only inspection - show what's stuck and the Stripe state if we can grab it.
      const enriched = await Promise.all((stuck || []).map(async p => {
        let stripeState = null;
        if (p.stripe_session_id) {
          try {
            const s = await stripe.checkout.sessions.retrieve(p.stripe_session_id);
            stripeState = { payment_status: s.payment_status, payment_intent: s.payment_intent };
          } catch (e) { stripeState = { error: e.message }; }
        }
        const m = byMember[p.member_id] || {};
        // "paid" at Stripe = real money in, just needs fulfilment. Anything else = the
        // customer opened checkout but never completed it → an abandoned checkout.
        const state = (stripeState && stripeState.payment_status === 'paid') ? 'paid_unfulfilled' : 'abandoned';
        return Object.assign({}, p, {
          stripe: stripeState,
          email: m.email || null,
          name: m.full_name || null,
          state
        });
      }));
      return res.status(200).json({ stuck: enriched, cutoff_minutes: STUCK_MINUTES });
    }

    if (req.method === 'POST') {
      // Replay each stuck payment that Stripe says was actually paid.
      const results = [];
      for (const p of stuck || []) {
        if (!p.stripe_session_id) {
          results.push({ payment_id: p.id, status: 'skipped_no_session_id' });
          continue;
        }
        let stripeSession;
        try {
          stripeSession = await stripe.checkout.sessions.retrieve(p.stripe_session_id);
        } catch (e) {
          // A session id we can't resolve will never reconcile - clear it so it stops being
          // stuck. This covers leftover test-mode ids (cs_test_) under the live key and
          // deleted/expired sessions. Transient errors keep the row pending for a retry.
          const unresolvable = e && (e.code === 'resource_missing' || e.statusCode === 404 ||
            /no such checkout\.session/i.test(e.message || ''));
          if (unresolvable) {
            await db.from('payments').update({ status: 'failed' }).eq('id', p.id);
            results.push({ payment_id: p.id, status: 'marked_failed_unresolvable', error: e.message });
          } else {
            results.push({ payment_id: p.id, status: 'stripe_fetch_failed', error: e.message });
          }
          continue;
        }
        if (stripeSession.payment_status !== 'paid') {
          // Mark as failed so it stops showing as stuck (customer never completed checkout).
          await db.from('payments').update({ status: 'failed' }).eq('id', p.id);
          results.push({ payment_id: p.id, status: 'marked_failed', stripe_status: stripeSession.payment_status });
          continue;
        }
        // Stripe says paid. Replay fulfilment - claim_fulfilment handles idempotency.
        const fulfil = await fulfillCheckoutSession(db, stripeSession);
        results.push({ payment_id: p.id, status: fulfil.ok ? (fulfil.fulfilled ? 'fulfilled' : 'already_processed') : 'failed', detail: fulfil.error || fulfil.reason || null });
      }
      return res.status(200).json({ processed: results.length, results });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[/api/admin/reconcile-payments]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
