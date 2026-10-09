// POST /api/trip-pay - MEMBERS ONLY. Stripe embedded checkout for a trip (the
// Musandam day escape), mirroring padel-pay.js. Deliberate differences:
//   - A trip is one date, read from trips.<slug>; nothing is advanced weekly.
//   - Seats: the buyer's own spot plus up to three friends by name. Friends
//     become guest members (createGuestMember, same as padel's bring-a-friend),
//     so the roster has every name and the bus has a headcount.
//   - Capacity counts PAID seats only; a checkout that asks for more seats than
//     are left is refused with the number left, never partially filled.
//   - Phone gate as padel: asked once, only of members we have no number for.
//
//   GET  /api/trip-pay?session_id=…           -> { status, payment_status }
//   POST /api/trip-pay { slug, phone?, guests?: [name] }  (Bearer required)
//        -> { client_secret, publishable_key, id, seats }
//        -> { needs_phone: true }
//        -> 401 { login_required: true } | 409 { sold_out, spots_left } | 409 { already_paid }
//
// Security: price, date and capacity come from the trips row, never the client.
// Service-role writes only.
const Stripe = require('stripe');
const { admin, getUser, ensureMember, createGuestMember, safeError } = require('./_lib');
const { cleanSlug } = require('./trip-status');

const MAX_GUESTS = 3;

// Same normaliser as the run check-in and padel: a local 05X becomes +9715X,
// an international number loses its spacing and keeps its code.
function cleanPhone(v) {
  if (v === undefined || v === null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  let s;
  if (raw.charAt(0) === '+') {
    s = '+' + raw.slice(1).replace(/[^\d]/g, '');
  } else {
    const d = raw.replace(/[^\d]/g, '').replace(/^0+/, '');
    if (!d) return null;
    s = d.indexOf('971') === 0 ? '+' + d : '+971' + d;
  }
  return /^\+\d{8,16}$/.test(s) ? s : null;
}

function dayLine(ymd) {
  try {
    return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' });
  } catch (e) { return ymd; }
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
  const slug = cleanSlug(body.slug);

  let user = null;
  try { user = await getUser(req); } catch (e) { user = null; }
  if (!user) return res.status(401).json({ error: 'Log in to book your spot.', login_required: true });

  try {
    const { data: trip } = await db.from('trips')
      .select('slug, title, trip_date, pickup_time, location, price_aed, capacity, enabled')
      .eq('slug', slug).maybeSingle();
    if (!trip || !trip.enabled) return res.status(400).json({ error: 'Bookings for this trip are not open.' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    if (trip.trip_date < today) return res.status(400).json({ error: 'This trip has already happened.' });
    const amount = Number(trip.price_aed || 0);
    if (!(amount > 0)) return res.status(400).json({ error: 'The price is not set yet.' });

    const memberId = await ensureMember(db, user);
    if (!memberId) return res.status(400).json({ error: 'Could not read your account. Try again.' });

    // Friends by name, up to three, deduplicated, blank entries dropped.
    const seen = new Set();
    const guestNames = (Array.isArray(body.guests) ? body.guests : [])
      .map((n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 80))
      .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
      .slice(0, MAX_GUESTS);

    // Own seat already paid? Then this checkout can only be for friends.
    const { data: mine } = await db.from('trip_signups')
      .select('paid').eq('trip_slug', slug).eq('member_id', memberId).maybeSingle();
    const selfIn = !!(mine && mine.paid);
    if (selfIn && guestNames.length === 0) {
      return res.status(409).json({ already_paid: true, error: "You're already in for this one." });
    }

    // Phone gate: a trip is a bus leaving at six in the morning; email is not
    // good enough to reach someone about the pick-up point. Asked once.
    const { data: meRow } = await db.from('members').select('phone').eq('id', memberId).maybeSingle();
    if (!(meRow && String(meRow.phone || '').trim())) {
      const given = cleanPhone(body.phone);
      if (!given) return res.status(200).json({ needs_phone: true });
      const { error: phErr } = await db.from('members').update({ phone: given }).eq('id', memberId);
      if (phErr) return safeError(res, 'trip-pay', phErr, 'Could not save your number. Try again.');
    }

    // Capacity: PAID seats only; pending checkouts hold nothing.
    const { count } = await db.from('trip_signups')
      .select('id', { count: 'exact', head: true })
      .eq('trip_slug', slug).eq('paid', true);
    const taken = count || 0;
    const capacity = Number(trip.capacity || 20);
    const seats = (selfIn ? 0 : 1) + guestNames.length;
    if (taken + seats > capacity) {
      const left = Math.max(0, capacity - taken);
      return res.status(409).json({
        sold_out: left === 0,
        spots_left: left,
        error: left === 0 ? 'This trip is sold out.' : 'Only ' + left + (left === 1 ? ' spot is' : ' spots are') + ' left for this trip.'
      });
    }

    // Guest members for the friends: reuse one this buyer already created
    // under the same name, so a retried checkout never mints a second account.
    const guestIds = [];
    for (const name of guestNames) {
      const { data: known } = await db.from('members')
        .select('id').eq('guest_of', memberId).eq('is_guest', true).eq('full_name', name).limit(1);
      let gid;
      if (known && known.length) gid = known[0].id;
      else gid = (await createGuestMember(db, { name, guestOf: memberId })).memberId;
      const { data: gIn } = await db.from('trip_signups')
        .select('paid').eq('trip_slug', slug).eq('member_id', gid).maybeSingle();
      if (gIn && gIn.paid) return res.status(409).json({ error: name + ' is already in for this trip.' });
      guestIds.push(gid);
    }

    const total = Math.round(amount * seats * 100) / 100;
    const metadata = {
      kind: 'trip', trip_slug: slug, member_id: memberId, run_date: trip.trip_date,
      self: selfIn ? '0' : '1', seats: String(seats), guest_ids: guestIds.join(','),
      location: trip.location || ''
    };

    const { data: pay } = await db.from('payments')
      .insert({ member_id: memberId, kind: 'trip', amount_aed: total, status: 'pending', run_date: trip.trip_date })
      .select('id').single();

    // Intent rows (unpaid) so the roster shows who started checkout; the
    // webhook flips them to paid. Rows already paid never reach this list.
    const now = new Date().toISOString();
    const rows = [];
    if (!selfIn) rows.push({ trip_slug: slug, member_id: memberId, paid: false, updated_at: now });
    guestIds.forEach((gid) => rows.push({ trip_slug: slug, member_id: gid, booked_by: memberId, paid: false, updated_at: now }));
    if (rows.length) await db.from('trip_signups').upsert(rows, { onConflict: 'trip_slug,member_id' });

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      branding_settings: { background_color: '#0a0a0a', button_color: '#B3B38A', border_style: 'rectangular' },
      line_items: [{
        quantity: seats,
        price_data: {
          currency: 'aed',
          unit_amount: Math.round(amount * 100),
          product_data: {
            name: trip.title,
            description: dayLine(trip.trip_date) + ' · ' + (trip.location || 'Musandam') + (seats > 1 ? ' · ' + seats + ' seats' : '')
          }
        }
      }],
      customer_email: user.email,
      metadata,
      payment_method_types: ['card'],
      redirect_on_completion: 'never'
    });

    if (pay) await db.from('payments').update({ stripe_session_id: session.id }).eq('id', pay.id);

    return res.status(200).json({
      client_secret: session.client_secret,
      id: session.id,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
      seats
    });
  } catch (e) {
    return safeError(res, 'trip-pay', e, 'Could not start payment. Try again or message us on WhatsApp.');
  }
};
