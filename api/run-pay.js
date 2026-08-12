// POST /api/run-pay - PUBLIC. Creates a Stripe embedded checkout for a PAID run
// (e.g. the Gems World Academy intervals session). Runs are normally free; this only
// works when the owner has flagged the current run as paid in event_config.
//
// Flow: the runner fills the normal registration form first (POST /api/run-register,
// which creates/links their member row by email). Then the /gems page calls this to
// take the AED entry fee. We look the member up by that email, create a pending payment,
// and let the Stripe webhook (fulfillCheckoutSession, kind:'run') mark the RSVP paid.
//
//   GET  /api/run-pay?session_id=…  -> { status, payment_status }  (confirm before success screen)
//   POST /api/run-pay  { email, run_date }  -> { client_secret, publishable_key, id }
//
// Security: price + paid flag come from event_config (server-side), never the client, so
// nobody can set their own amount. Service-role writes only.
const Stripe = require('stripe');
const { admin, authService, getUser, ensureMember, safeError } = require('./_lib');

function cleanEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

function validRunDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() < now - 2 * 86400000) return null;   // not in the past
  if (d.getTime() > now + 60 * 86400000) return null;  // not absurdly far out
  return s;
}

// weekday label for run_type, in Dubai time.
function weekdayType(runDate) {
  try {
    const d = new Date(runDate + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dubai' }).toLowerCase();
  } catch (e) { return null; }
}

// Ensure a member row exists for this email so the payment (and the webhook's RSVP
// upsert) has a stable member_id to hang off. Idempotent - reuses the row that
// run-register just created, or provisions a passwordless account if we somehow got
// here first.
async function ensureRunnerByEmail(db, email, fullName) {
  const { data: m } = await db.from('members').select('id').eq('email', email).maybeSingle();
  if (m) return m.id;
  try {
    const auth = authService();
    const { data: created } = await auth.auth.admin.createUser({
      email, email_confirm: true, user_metadata: fullName ? { full_name: fullName } : {}
    });
    if (created && created.user) {
      await db.from('members').upsert({ id: created.user.id, email, full_name: fullName || null }, { onConflict: 'id' });
      return created.user.id;
    }
  } catch (e) { /* already registered or transient - fall through to re-lookup */ }
  const { data: m2 } = await db.from('members').select('id').eq('email', email).maybeSingle();
  return m2 ? m2.id : null;
}

module.exports = async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Confirm a finished embedded checkout is really paid before the client shows success.
  if (req.method === 'GET') {
    const sid = req.query && req.query.session_id;
    if (!sid) return res.status(400).json({ error: 'Missing session_id' });
    try {
      const s = await stripe.checkout.sessions.retrieve(String(sid));
      return res.status(200).json({ status: s.status, payment_status: s.payment_status });
    } catch (e) {
      return res.status(400).json({ error: 'Could not retrieve session' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = admin();
  const body = req.body || {};
  const run_date = validRunDate(body.run_date);
  if (!run_date) return res.status(400).json({ error: 'Invalid run date' });

  // Logged-in members pay straight from their account (no re-entering details); guests
  // pay with the email the public form just captured.
  let user = null;
  try { user = await getUser(req); } catch (e) { user = null; }

  try {
    // Price + paid flag are owner-controlled, server-side only.
    const { data: cfg } = await db.from('event_config')
      .select('run_paid, run_price_aed, location').eq('id', 1).maybeSingle();
    if (!cfg || !cfg.run_paid) {
      return res.status(400).json({ error: 'This run is not a paid run.' });
    }
    const amount = Number(cfg.run_price_aed || 0);
    if (!(amount > 0)) return res.status(400).json({ error: 'Run price is not set.' });

    // Resolve the member: session if logged in, else by the captured email.
    let memberId, custEmail;
    if (user) {
      memberId = await ensureMember(db, user);
      custEmail = user.email;
    } else {
      const email = cleanEmail(body.email);
      if (!email) return res.status(400).json({ error: 'A valid email is required' });
      const { data: member } = await db.from('members').select('id').eq('email', email).maybeSingle();
      memberId = member ? member.id : await ensureRunnerByEmail(db, email, null);
      custEmail = email;
    }
    if (!memberId) return res.status(400).json({ error: 'Register first, then pay.' });

    // Already paid for this run? Don't charge twice. The payments table is the money source
    // of truth (a real 'paid' run payment for this run_date), so we don't rely only on the
    // run_rsvps.paid side-effect, which can lag if the webhook rsvp-write fails.
    const { data: paidAlready } = await db.from('payments')
      .select('id').eq('member_id', memberId).eq('kind', 'run').eq('status', 'paid').eq('run_date', run_date).limit(1);
    if (paidAlready && paidAlready.length) {
      return res.status(409).json({ error: "You're already paid in for this run. See you there." });
    }

    const run_type = weekdayType(run_date);
    const metadata = { member_id: memberId, kind: 'run', run_date: run_date, run_type: run_type || '', location: cfg.location || '' };

    // Record a pending payment up front (reconciled by the webhook). run_date ties the
    // payment to this specific run so the roster + double-charge guard can read it precisely.
    const { data: pay } = await db.from('payments')
      .insert({ member_id: memberId, kind: 'run', amount_aed: amount, status: 'pending', run_date: run_date })
      .select('id').single();

    // Make sure an (unpaid) RSVP row exists so the roster shows intent even if they
    // drop off before paying. Webhook flips paid=true on success.
    await db.from('run_rsvps').upsert(
      { member_id: memberId, run_date: run_date, run_type: run_type, attending: true, updated_at: new Date().toISOString() },
      { onConflict: 'member_id,run_date' }
    );

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'aed',
          unit_amount: Math.round(amount * 100), // fils
          product_data: {
            name: 'LFG Run · ' + (cfg.location || 'Dubai'),
            description: 'Entry · intervals session'
          }
        }
      }],
      customer_email: custEmail,
      metadata: metadata,
      payment_method_types: ['card'],
      redirect_on_completion: 'never'
    });

    if (pay) await db.from('payments').update({ stripe_session_id: session.id }).eq('id', pay.id);

    return res.status(200).json({
      client_secret: session.client_secret,
      id: session.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (e) {
    return safeError(res, 'run-pay', e, 'Could not start payment. Try again or message us on WhatsApp.');
  }
};
