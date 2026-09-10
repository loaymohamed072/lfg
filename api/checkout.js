// POST /api/checkout - creates a Stripe Checkout Session (test mode).
// Body: { kind:'single'|'package'|'merch'|'sponsor', package_id?, session_id?, promo_code?, qty?, note? }
// Returns: { url } to redirect the member to Stripe.
const Stripe = require('stripe');
const { admin, getUser, ensureMember, validatePromoCode, safeError } = require('./_lib');

module.exports = async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // GET /api/checkout?session_id=… - confirm a finished embedded checkout is actually
  // paid before the client shows the success screen. onComplete fires client-side;
  // this is the server-side source of truth.
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
  const kind = body.kind;

  try {
    // Guarantee the member row exists before writing payments (FK dependency).
    await ensureMember(db, user);

    let lineItem, promo = null;
    const metadata = { member_id: user.id, kind: kind };

    if (kind === 'package') {
      const { data: pkg } = await db.from('packages').select('*').eq('id', body.package_id).eq('active', true).single();
      if (!pkg) return res.status(400).json({ error: 'Package not available' });
      let amount = Number(pkg.price_aed);
      if (body.promo_code) {
        const p = await validatePromoCode(db, body.promo_code, amount, user.email);
        if (!p.ok) return res.status(400).json({ error: p.error });
        // Referral + reward (RWD-) codes are single-session only - never discount a package.
        if (p.is_referral || /^RWD-/i.test(p.code || '')) return res.status(400).json({ error: 'Referral and reward codes only work on a single session, not packages.' });
        amount = p.final_amount; promo = p.code; metadata.promo_code = promo;
      }
      metadata.package_id = String(pkg.id);
      lineItem = priceItem(amount, 'LFG - ' + pkg.name, pkg.sessions_count + ' bootcamp credits · valid ' + pkg.validity_months + ' months');

    } else if (kind === 'single') {
      const { data: sess } = await db.from('sessions').select('*').eq('id', body.session_id).eq('status', 'open').single();
      if (!sess) return res.status(400).json({ error: 'Session not available' });
      // Guard against paying twice for the same session. A member can only hold one
      // booking per session (unique index member_id+session_id), so a second single
      // checkout would capture the card but book_paid would dedup it - money in, no
      // ticket. Block it here before any charge. (Re-booking a previously cancelled
      // slot is still allowed.)
      const { data: existingBk } = await db.from('bookings').select('id')
        .eq('session_id', sess.id).eq('member_id', user.id).in('status', ['booked', 'attended']).maybeSingle();
      if (existingBk) return res.status(409).json({ error: "You're already booked for this session. Check your account - no need to pay again." });
      // Don't sell a single seat for a full session.
      const { count } = await db.from('bookings').select('id', { count: 'exact', head: true })
        .eq('session_id', sess.id).in('status', ['booked', 'attended']);
      if ((count || 0) >= sess.capacity) return res.status(409).json({ error: 'Session is full' });

      let amount = Number(process.env.SINGLE_SESSION_PRICE_AED || 99);
      if (body.promo_code) {
        const p = await validatePromoCode(db, body.promo_code, amount, user.email);
        if (!p.ok) return res.status(400).json({ error: p.error });
        amount = p.final_amount; promo = p.code; metadata.promo_code = promo;
      }
      metadata.session_id = String(sess.id);
      if (/^[A-Z]$/.test(body.section)) metadata.section = body.section; // preferred station
      lineItem = priceItem(amount, 'LFG Bootcamp - Single Session', new Date(sess.session_date).toDateString());

    } else if (kind === 'sponsor') {
      // Sponsored bootcamp tickets: pay N single sessions forward to the
      // community. Nothing is booked for the buyer; the tickets land in a pool
      // that admins hand out by name (see api/admin/sponsored.js). Priced at the
      // single-session rate so "one ticket" means what it says on /packages.
      // No promo codes: a discount on a gift to the community makes no sense,
      // and referral codes are single-session only anyway.
      const qty = Math.round(Number(body.qty));
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) return res.status(400).json({ error: 'Choose between 1 and 50 tickets' });
      if (body.promo_code) return res.status(400).json({ error: 'Promo codes do not apply to sponsored tickets' });
      const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      const perTicket = Number(process.env.SINGLE_SESSION_PRICE_AED || 99);
      const amount = perTicket * qty;
      metadata.qty = String(qty);
      if (note) metadata.note = note;
      lineItem = priceItem(
        amount,
        'LFG Bootcamp - Sponsored ticket' + (qty === 1 ? '' : 's') + ' × ' + qty,
        'Paid forward to the LFG community · handed out by the coaches'
      );
    } else if (kind === 'merch') {
      // The single LFG x PUMA tee. No address - handed over at the next run.
      const ALLOWED_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
      const size = String(body.size || '').toUpperCase();
      if (ALLOWED_SIZES.indexOf(size) === -1) return res.status(400).json({ error: 'Pick a size' });
      // Stock gate: if the admin has set per-size stock, sell only while paid units
      // are below the cap (no hold for pending checkouts). Otherwise fall back to the
      // legacy manual sold-out toggle.
      const { data: cfg } = await db.from('event_config').select('tee_soldout_sizes,tee_stock').eq('id', 1).maybeSingle();
      const stock = (cfg && cfg.tee_stock) || {};
      if (stock && Object.keys(stock).length > 0) {
        const { count: sold } = await db.from('merch_orders').select('id', { count: 'exact', head: true })
          .eq('size', size).neq('status', 'cancelled');
        if (Number(stock[size] || 0) - (sold || 0) <= 0) return res.status(409).json({ error: 'That size just sold out' });
      } else {
        const soldout = (cfg && cfg.tee_soldout_sizes) || [];
        if (soldout.indexOf(size) !== -1) return res.status(409).json({ error: 'That size just sold out' });
      }

      const amount = Number(process.env.MERCH_TEE_PRICE_AED || 150);
      metadata.product = 'lfg-tee-2025';
      metadata.size = size;
      lineItem = priceItem(amount, 'LFG Tee · LFG × PUMA', 'Size ' + size + ' · pick up at the next run');

    } else {
      return res.status(400).json({ error: 'Invalid checkout kind' });
    }

    // Record a pending payment up front (reconciled by the webhook).
    const { data: pay, error: payErr } = await db.from('payments')
      .insert({ member_id: user.id, kind: kind, amount_aed: lineItem.price_data.unit_amount / 100, promo_code: promo, status: 'pending' })
      .select('id').single();
    if (payErr) throw new Error('payment insert: ' + payErr.message);

    // Embedded checkout: Stripe renders inside a window on our own page instead of
    // redirecting off-site. No success/cancel URL - the client uses onComplete and we
    // confirm via the GET handler above. Fulfilment still runs from `metadata` in the
    // webhook, so the server-side flow is unchanged.
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      line_items: [lineItem],
      customer_email: user.email,
      metadata: metadata,
      payment_method_types: ['card'],
      redirect_on_completion: 'never'
    });

    if (pay) await db.from('payments').update({ stripe_session_id: session.id }).eq('id', pay.id);
    res.status(200).json({
      client_secret: session.client_secret,
      id: session.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY
    });

  } catch (e) {
    return safeError(res, 'checkout', e, 'Checkout failed. Try again or message us on WhatsApp.');
  }
};

function priceItem(amountAed, name, description) {
  return {
    quantity: 1,
    price_data: {
      currency: 'aed',
      unit_amount: Math.round(Number(amountAed) * 100), // fils
      product_data: { name: name, description: description }
    }
  };
}
