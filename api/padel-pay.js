// POST /api/padel-pay - MEMBERS ONLY. Stripe embedded checkout for a padel night,
// mirroring run-pay.js. Differences from runs, all deliberate:
//   - The event date is resolved SERVER-SIDE from event_config.padel_datetime
//     (7-day advance + 1h grace); the client never picks a date.
//   - Capacity is enforced here (paid signups vs padel_capacity) -> 409 sold_out.
//   - No guest checkout: a spot carries a level, points and a court placing,
//     so it must hang off a real account (Loay's call, 2026-08-09).
//   - First-timers must answer the 5-question skill quiz before checkout opens:
//     a POST without answers for a player with no padel_profiles row returns
//     { needs_questionnaire: true } and has NO side effects. Answers are scored
//     server-side into a 1.0-7.0 level (padel scale) that the admin roster uses
//     to build level-matched courts.
//
//   GET  /api/padel-pay?session_id=…  -> { status, payment_status }
//   POST /api/padel-pay { answers? }  (Bearer token required)
//        -> { client_secret, publishable_key, id } | { needs_questionnaire: true }
//        -> 401 { login_required: true } when signed out
//
// Security: price, date, and capacity come from event_config (server-side),
// never the client. Level scoring is server-side. Service-role writes only.
//   - Bringing a friend: a member who has ALREADY PAID for this night may buy
//     additional spots for people without an LFG account. The friend becomes a
//     guest member (see createGuestMember in _lib) and the buyer answers the
//     same five questions on their behalf, scored identically but flagged
//     `estimated` so the roster knows the level is a guess, not a self-report.
//     The already-paid gate is what keeps this from being the public guest
//     checkout that was closed on 2026-08-09.
const Stripe = require('stripe');
const { admin, getUser, ensureMember, createGuestMember, safeError } = require('./_lib');
const { resolveEvent } = require('./padel-status');

// One entry per quiz question, answers ordered easiest -> strongest. The score
// is the sum of answer indexes (0-14): level = 1.0 + 0.4 x score, snapped to
// 0.5, clamped 1.0-7.0. A first-timer who has never held a racket seeds 1.0;
// a competitive player answering top marks seeds 6.5-7.0.
const QUIZ = {
  played: ['never', 'few', 'regular', 'competitive'],
  racket: ['none', 'casual', 'serious'],
  frequency: ['first', 'sometimes', 'weekly', 'most-days'],
  court: ['learning', 'rally', 'attack', 'control'],
  self: ['beginner', 'improver', 'intermediate', 'advanced']
};

function computeLevel(answers) {
  if (!answers || typeof answers !== 'object') return null;
  let score = 0;
  for (const key of Object.keys(QUIZ)) {
    const idx = QUIZ[key].indexOf(answers[key]);
    if (idx < 0) return null;
    score += idx;
  }
  return Math.min(7, Math.max(1, Math.round((1 + score * 0.4) * 2) / 2));
}

module.exports = async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

  // Booking requires a signed-in member. A padel spot carries a level, a
  // points total and a court placing, so it hangs off a real account rather
  // than a typed-in email. This also closes the abuse surface outright: with
  // no guest path there is nothing here that can mint an auth account, which
  // is what produced ~220 junk signups on the GoTrue endpoint in Aug 2026.
  let user = null;
  try { user = await getUser(req); } catch (e) { user = null; }
  if (!user) return res.status(401).json({ error: 'Log in to book your spot.', login_required: true });

  try {
    const { data: cfg } = await db.from('event_config')
      .select('padel_enabled, padel_datetime, padel_location, padel_price_aed, padel_capacity')
      .eq('id', 1).maybeSingle();
    if (!cfg || !cfg.padel_enabled || !cfg.padel_datetime) {
      return res.status(400).json({ error: 'Padel bookings are not open yet.' });
    }
    const amount = Number(cfg.padel_price_aed || 0);
    if (!(amount > 0)) return res.status(400).json({ error: 'Padel price is not set.' });
    const ev = resolveEvent(cfg.padel_datetime);
    if (!ev) return res.status(400).json({ error: 'Padel bookings are not open yet.' });

    // The member is the signed-in user; the 401 above is the only other exit.
    const memberId = await ensureMember(db, user);
    const custEmail = user.email;
    if (!memberId) return res.status(400).json({ error: 'Could not read your account. Try again.' });

    // Is this a spot for someone else? The buyer still pays; the spot, level
    // and court placing belong to the friend.
    const guestName = body.guest && String(body.guest.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const forGuest = !!guestName;
    if (body.guest && !guestName) {
      return res.status(400).json({ error: "Enter your friend's name." });
    }

    // Double-charge guard: the payments table is the money source of truth.
    // Unchanged for an ordinary booking, and it is the SAME read that tells us
    // whether a friend purchase is allowed, so the guest path costs no extra
    // query: buying for someone else requires having paid for yourself first,
    // which is exactly what this row proves. Without that gate the endpoint
    // becomes the public guest checkout removed on 2026-08-09.
    const { data: paidAlready } = await db.from('payments')
      .select('id').eq('member_id', memberId).eq('kind', 'padel')
      .eq('status', 'paid').eq('run_date', ev.ymd).limit(1);
    const buyerIsIn = !!(paidAlready && paidAlready.length);

    if (forGuest) {
      if (!buyerIsIn) {
        return res.status(409).json({ error: 'Book your own spot first, then you can bring a friend.' });
      }
    } else if (buyerIsIn) {
      return res.status(409).json({ already_paid: true, error: "You're already in for this night. See you on court." });
    }

    // Capacity gate: count PAID signups only; pending checkouts don't hold spots.
    const { count } = await db.from('padel_signups')
      .select('member_id', { count: 'exact', head: true })
      .eq('event_date', ev.ymd).eq('paid', true);
    const capacity = Number(cfg.padel_capacity || 16);
    if ((count || 0) >= capacity) {
      return res.status(409).json({ sold_out: true, error: 'This night is sold out.' });
    }

    // Questionnaire gate. No profile + no answers -> tell the drawer to run the
    // quiz (no side effects). No profile + answers -> score and create the
    // profile. Existing profile -> straight through.
    //
    // A friend has no profile by definition, so the quiz always runs for them,
    // and the answers describe the FRIEND rather than the buyer. Asking before
    // the guest account exists is deliberate: an abandoned quiz must not leave
    // an account behind.
    if (forGuest) {
      if (!body.answers) return res.status(200).json({ needs_questionnaire: true, for_guest: true });
      const level = computeLevel(body.answers);
      if (level == null) return res.status(400).json({ error: 'Answer all five questions.' });
    } else {
      const { data: profile } = await db.from('padel_profiles')
        .select('member_id').eq('member_id', memberId).maybeSingle();
      if (!profile) {
        if (!body.answers) return res.status(200).json({ needs_questionnaire: true });
        const level = computeLevel(body.answers);
        if (level == null) return res.status(400).json({ error: 'Answer all five questions.' });
        const { error: pErr } = await db.from('padel_profiles').insert({
          member_id: memberId, level, initial_level: level, answers: body.answers
        });
        // A racing duplicate insert is fine; anything else is a real failure.
        if (pErr && !/duplicate key|unique/i.test(pErr.message || '')) {
          return safeError(res, 'padel-pay', pErr, 'Could not save your answers. Try again.');
        }
      }
    }

    // Who the spot is FOR. Everything downstream (signup, level, court, board)
    // keys on this; the buyer only appears on the payment.
    let playerId = memberId;
    if (forGuest) {
      // Reuse a guest this buyer has already created under the same name, so an
      // abandoned checkout retried does not mint a second account for the same
      // person. Scoped to guests THIS member brought, so one buyer's "Sarah"
      // can never resolve to another buyer's.
      const { data: known } = await db.from('members')
        .select('id').eq('guest_of', memberId).eq('is_guest', true)
        .eq('full_name', guestName).limit(1);
      if (known && known.length) {
        playerId = known[0].id;
      } else {
        const guest = await createGuestMember(db, {
          name: guestName,
          email: body.guest && body.guest.email,
          guestOf: memberId
        });
        playerId = guest.memberId;
      }

      const { data: guestIn } = await db.from('padel_signups')
        .select('member_id').eq('member_id', playerId).eq('event_date', ev.ymd)
        .eq('paid', true).limit(1);
      if (guestIn && guestIn.length) {
        return res.status(409).json({ already_paid: true, error: guestName + ' is already in for this night.' });
      }

      // Only seed a level if they have none. If the friend turns out to be an
      // existing LFG player, the level they set for themselves outranks the
      // buyer's guess and must not be overwritten.
      const { data: theirProfile } = await db.from('padel_profiles')
        .select('member_id').eq('member_id', playerId).maybeSingle();
      if (!theirProfile) {
        const level = computeLevel(body.answers);
        const { error: gpErr } = await db.from('padel_profiles').insert(
          { member_id: playerId, level, initial_level: level, answers: body.answers, estimated: true }
        );
        if (gpErr && !/duplicate key|unique/i.test(gpErr.message || '')) {
          return safeError(res, 'padel-pay', gpErr, 'Could not save their answers. Try again.');
        }
      }
    }

    // member_id stays the BUYER so the money and the confirmation email reach
    // the person who paid; padel_for carries the spot to the friend.
    const metadata = { member_id: memberId, kind: 'padel', run_date: ev.ymd, location: cfg.padel_location || '' };
    if (forGuest) {
      metadata.padel_for = playerId;
      metadata.guest_name = guestName;
    }

    const { data: pay } = await db.from('payments')
      .insert({ member_id: memberId, kind: 'padel', amount_aed: amount, status: 'pending', run_date: ev.ymd })
      .select('id').single();

    // Intent row so the roster shows who started checkout; webhook flips paid.
    // Keyed to the player, so a friend appears as the pending player rather
    // than the buyer appearing twice.
    await db.from('padel_signups').upsert(
      { member_id: playerId, event_date: ev.ymd, attending: true, updated_at: new Date().toISOString() },
      { onConflict: 'member_id,event_date' }
    );

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      branding_settings: {
        background_color: '#0a0a0a',
        button_color: '#B3B38A',
        border_style: 'rectangular'
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'aed',
          unit_amount: Math.round(amount * 100), // fils
          product_data: {
            name: 'LFG Padel · ' + (cfg.padel_location || 'Dubai'),
            description: forGuest
              ? 'Court entry for ' + guestName + ' · matched to their level'
              : 'Court entry · matched to your level'
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
    return safeError(res, 'padel-pay', e, 'Could not start payment. Try again or message us on WhatsApp.');
  }
};
