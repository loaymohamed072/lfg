// POST /api/stripe-webhook - fulfills paid checkouts (test mode).
// On checkout.session.completed: credits a package OR books a single session.
// All fulfilment logic lives in _lib.js so the admin reconcile endpoint can
// reuse it for stuck-payment recovery.
//
// NOTE for Vercel deploy: disable body parsing so the raw body reaches signature
// verification (handled by reading the raw stream below; on Vercel add the
// bodyParser:false config for this route).
const Stripe = require('stripe');
const { admin, fulfillCheckoutSession } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const raw = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[webhook] signature verification failed:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  try {
    const result = await fulfillCheckoutSession(admin(), event.data.object);
    if (!result.ok) {
      console.error('[webhook] fulfilment hard-failed:', result.error);
      return res.status(500).json({ error: result.error });
    }
    return res.status(200).json({ received: true, ...result });
  } catch (e) {
    console.error('[webhook] threw:', e);
    return res.status(500).json({ error: 'Fulfillment failed' });
  }
};

function getRawBody(req) {
  if (req.rawBody != null) return Promise.resolve(req.rawBody);
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
}
