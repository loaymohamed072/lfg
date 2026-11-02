// POST /api/checkout - creates a Stripe Checkout Session (test mode).
// Body: { kind:'single'|'package'|'merch'|'sponsor', package_id?, session_id?, promo_code?, qty?, note? }
// Train with a friend (2026-11-02), both on kind 'single':
//   join: TOKEN          a friend pays for a spot a host saved (price + station from the hold)
//   friends: [{name,email}] (1-7) + section   the buyer pays for themselves and friends, one
//                        station. A 35-minute checkout hold keeps the group's spots while
//                        they pay; the payment row is kind 'group'.
// Auth: required for every kind except 'sponsor', which is public (see below).
// Returns: { url } to redirect the member to Stripe.
const Stripe = require('stripe');
const { admin, getUser, ensureMember, validatePromoCode, earlyWeekPromo, earlyWeekPrice, safeError } = require('./_lib');
const { cleanMcId } = require('./_manychat');
const F = require('./_friends');

module.exports = async (req, res) => {
  const user = await getUser(req);
  // Sponsored tickets are the one PUBLIC checkout on the site. They are a gift to
  // the community, nothing is booked for the buyer, and the buyer is usually a
  // guest of Reem's PR list rather than an LFG member. Demanding an account here
  // would either lose the sale or mint an auth user from a typed-in email, which
  // is exactly the path closed on 2026-08-09 (~220 junk GoTrue signups). So the
  // sponsor stays anonymous to us and Stripe collects their name and email.
  // The GET branch below only reports the paid/unpaid status of a session id the
  // caller already holds, so it is safe to leave open for that same guest.
  const publicSponsor = !user && (
    req.method === 'GET' || (req.method === 'POST' && (req.body || {}).kind === 'sponsor')
  );
  if (!user && !publicSponsor) return res.status(401).json({ error: 'Not authenticated' });

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
    // An anonymous sponsor has no member row and must not be given one.
    if (user) await ensureMember(db, user);

    let lineItem, promo = null;
    const metadata = { kind: kind };
    if (user) metadata.member_id = user.id;
    // ManyChat subscriber id from a DM booking link (bootcamp singles and packs); the
    // webhook tags booked-bootcamp once the payment clears.
    const mc_id = cleanMcId(body.mc_id);
    if (mc_id && (kind === 'single' || kind === 'package')) metadata.mc_id = mc_id;
    // Monday to Wednesday (Dubai) a single is discounted; packs stay at list price
    // every day (Loay, 2 Nov 2026). A promo code is honoured only when it beats
    // that discount; the two never stack.
    const early = await earlyWeekPromo(db);
    const earlyNote = early.active ? ' · ' + early.percent + '% off, booked ' + early.days : '';
    const NO_EARLY = { active: false, percent: 0 };
    async function priceWithPromo(base, code, week = early) {
      const earlyAmount = earlyWeekPrice(base, week);
      if (!code) return { amount: earlyAmount, early: week.active };
      const p = await validatePromoCode(db, code, base, user.email);
      if (!p.ok) return { error: p.error };
      if (week.active && p.final_amount >= earlyAmount) {
        return { error: "This week's " + week.percent + "% off is already on the price and beats this code. Remove the code to continue." };
      }
      return { amount: p.final_amount, early: false, promo: p };
    }

    // The buyer plus 1-7 friends on one station, paid by card for everyone (the buyer's
    // credits are never spent on friends). Skips the balancing window, never the station
    // cap. Nothing here looks a typed email up or makes an account: the answer is the same
    // whoever the friends are, and their accounts are only made after the payment succeeds
    // (fulfilGroup). create_booking_hold carries every limit: station room, 16 checkout-held
    // spots per Sunday, 3 unpaid group checkouts per buyer per day.
    async function startGroup() {
      const f = F.cleanFriends(body.friends, user.email);
      if (!f.ok) return res.status(400).json({ error: f.error });
      const friends = f.friends;
      const section = String(body.section || '');
      if (!/^[A-Z]$/.test(section)) return res.status(400).json({ error: 'Pick a station' });
      const { data: sess } = await db.from('sessions').select('*').eq('id', body.session_id).eq('status', 'open').maybeSingle();
      if (!sess) return res.status(400).json({ error: 'Session not available' });
      if (!F.bookingOpen(sess, Date.now())) return res.status(409).json({ error: 'Booking has closed for this Sunday.' });
      const { data: existingBk } = await db.from('bookings').select('id')
        .eq('session_id', sess.id).eq('member_id', user.id).in('status', ['booked', 'attended']).maybeSingle();
      if (existingBk) return res.status(409).json({ error: "You're already booked for this session. Hold spots for friends from My bookings instead." });

      // The buyer's seat can carry a promo code; friends pay the normal ticket.
      const list = F.listPrice();
      const buyer = await priceWithPromo(list, body.promo_code);
      if (buyer.error) return res.status(400).json({ error: buyer.error });
      const friendAmount = earlyWeekPrice(list, early);

      const people = friends.length + 1;
      const noRoom = (r) => r > 0
        ? 'Station ' + section + ' has room for ' + r + ' of you. Pick another station or remove a friend.'
        : 'Station ' + section + ' is full. Pick another station.';
      const { data: held, error: hErr } = await db.rpc('create_booking_hold', {
        p_host: user.id, p_session: sess.id, p_kind: 'checkout', p_spots: people, p_price: friendAmount,
        p_section: section, p_friends: friends.map((x) => ({ name: x.name, email: x.email }))
      });
      if (hErr) throw new Error('create_booking_hold: ' + hErr.message);
      if (!held || !held.ok) {
        return res.status(409).json({ error: held && held.room != null ? noRoom(held.room) : ((held && held.error) || 'Could not hold the spots.'), room: held && held.room });
      }
      // The new hold replaced an earlier unpaid one: close that card form for good.
      if (held.replaced_stripe_session) {
        try { await stripe.checkout.sessions.expire(held.replaced_stripe_session); } catch (e) { /* already closed */ }
      }
      const releaseHold = () => db.from('booking_holds').update({ cancelled_at: new Date().toISOString() }).eq('id', held.hold_id);

      const total = Math.round((buyer.amount + friendAmount * friends.length) * 100) / 100;
      const gmeta = {
        kind: 'group', member_id: user.id, session_id: String(sess.id), section, hold_id: held.hold_id,
        buyer_amount: String(buyer.amount), friend_amount: String(friendAmount), seats: String(people)
      };
      if (buyer.promo) gmeta.promo_code = buyer.promo.code;
      if (mc_id) gmeta.mc_id = mc_id;
      const { data: pay, error: payErr } = await db.from('payments')
        .insert({ member_id: user.id, kind: 'group', amount_aed: total, promo_code: buyer.promo ? buyer.promo.code : null, status: 'pending' })
        .select('id').single();
      if (payErr) { await releaseHold(); throw new Error('payment insert: ' + payErr.message); }

      const day = new Date(sess.session_date).toDateString();
      const friendLine = priceItem(friendAmount, "LFG Bootcamp - Friend's ticket", day + ' · Station ' + section + ' with you');
      friendLine.quantity = friends.length;
      let session;
      try {
        session = await stripe.checkout.sessions.create({
          ui_mode: 'embedded_page',
          mode: 'payment',
          line_items: [
            priceItem(buyer.amount, 'LFG Bootcamp - Single Session', day + ' · Station ' + section + (buyer.early ? earlyNote : '')),
            friendLine
          ],
          customer_email: user.email,
          metadata: gmeta,
          payment_method_types: ['card'],
          redirect_on_completion: 'never',
          // The hold lasts 35 minutes; the card form closes before it does.
          expires_at: Math.floor(Date.now() / 1000) + F.STRIPE_EXPIRE_MIN * 60
        });
      } catch (e) {
        await releaseHold();
        await db.from('payments').update({ status: 'failed' }).eq('id', pay.id);
        throw e;
      }
      await Promise.all([
        db.from('payments').update({ stripe_session_id: session.id }).eq('id', pay.id),
        db.from('booking_holds').update({ stripe_session_id: session.id }).eq('id', held.hold_id)
      ]);
      return res.status(200).json({
        client_secret: session.client_secret, id: session.id, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY, seats: people
      });
    }

    if (kind === 'package') {
      const { data: pkg } = await db.from('packages').select('*').eq('id', body.package_id).eq('active', true).single();
      if (!pkg) return res.status(400).json({ error: 'Package not available' });
      const priced = await priceWithPromo(Number(pkg.price_aed), body.promo_code, NO_EARLY);
      if (priced.error) return res.status(400).json({ error: priced.error });
      if (priced.promo) {
        // Referral + reward (RWD-) codes are single-session only - never discount a package.
        if (priced.promo.is_referral || /^RWD-/i.test(priced.promo.code || '')) return res.status(400).json({ error: 'Referral and reward codes only work on a single session, not packages.' });
        promo = priced.promo.code; metadata.promo_code = promo;
      }
      metadata.package_id = String(pkg.id);
      lineItem = priceItem(priced.amount, 'LFG - ' + pkg.name, pkg.sessions_count + ' bootcamp credits · valid ' + pkg.validity_months + ' months' + (priced.early ? earlyNote : ''));

    } else if (kind === 'single' && body.join != null) {
      // A friend paying for a spot a host saved for them. The price was locked in the
      // hold (never more than today's), the station is the host's, and promo codes do
      // not apply to a saved spot.
      const tok = String(body.join);
      if (!F.validToken(tok)) return res.status(400).json({ error: 'This invite link is not valid.' });
      const { data: h } = await db.from('booking_holds')
        .select('id,session_id,section,host_member_id,spots,claimed,price_aed,expires_at,cancelled_at')
        .eq('token', tok).eq('kind', 'invite').maybeSingle();
      if (!h) return res.status(404).json({ error: 'This invite link is not valid.' });
      if (h.host_member_id === user.id) return res.status(409).json({ error: 'This is your own invite link.' });
      const state = F.holdState(h, Date.now());
      if (state !== 'active') {
        return res.status(409).json({ status: state, error: state === 'full' ? 'The saved spots on this invite are all taken.' : 'This saved spot has ended.' });
      }
      if (body.promo_code) return res.status(400).json({ error: "Promo codes don't apply to a saved spot." });
      const { data: sess } = await db.from('sessions').select('*').eq('id', h.session_id).eq('status', 'open').maybeSingle();
      if (!sess || !F.bookingOpen(sess, Date.now())) return res.status(400).json({ error: 'Session not available' });
      const { data: existingBk } = await db.from('bookings').select('id')
        .eq('session_id', sess.id).eq('member_id', user.id).in('status', ['booked', 'attended']).maybeSingle();
      if (existingBk) return res.status(409).json({ error: "You're already booked for this session. Check your account - no need to pay again." });
      const amount = Math.min(Number(h.price_aed), earlyWeekPrice(F.listPrice(), early));
      metadata.session_id = String(sess.id);
      metadata.section = h.section;
      metadata.hold_id = h.id;
      lineItem = priceItem(amount, 'LFG Bootcamp - Single Session', new Date(sess.session_date).toDateString() + ' · Station ' + h.section + ' with a friend');

    } else if (kind === 'single' && hasFriends(body.friends)) {
      return await startGroup();

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
      // Don't sell a single seat for a full session. Spots held for friends count as taken,
      // unless the Sunday can still grow: book_paid then grows it for this payer.
      const { count } = await db.from('bookings').select('id', { count: 'exact', head: true })
        .eq('session_id', sess.id).in('status', ['booked', 'attended']);
      const held = F.heldBySession(await F.liveHolds(db, [sess.id]), Date.now())[sess.id];
      const taken = (count || 0) + (held ? held.total : 0);
      if (taken >= F.capacityForBooker(sess, count || 0, held ? held.total : 0)) return res.status(409).json({ error: 'Session is full' });

      const priced = await priceWithPromo(Number(process.env.SINGLE_SESSION_PRICE_AED || 99), body.promo_code);
      if (priced.error) return res.status(400).json({ error: priced.error });
      if (priced.promo) { promo = priced.promo.code; metadata.promo_code = promo; }
      metadata.session_id = String(sess.id);
      if (/^[A-Z]$/.test(body.section)) metadata.section = body.section; // preferred station
      lineItem = priceItem(priced.amount, 'LFG Bootcamp - Single Session', new Date(sess.session_date).toDateString() + (priced.early ? earlyNote : ''));

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
      .insert({ member_id: user ? user.id : null, kind: kind, amount_aed: lineItem.price_data.unit_amount / 100, promo_code: promo, status: 'pending' })
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
      // No customer_email for an anonymous sponsor: Stripe collects it, and that
      // is where the attribution on the hand-out comes from.
      customer_email: user ? user.email : undefined,
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

// True when the body carries at least one friend row with anything typed in it.
function hasFriends(list) {
  return Array.isArray(list) && list.some((f) => f && (String(f.name || '').trim() || String(f.email || '').trim()));
}

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
