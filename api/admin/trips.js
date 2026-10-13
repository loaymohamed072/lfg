// /api/admin/trips - the trips desk (Musandam and any later day trip). Admin only.
//
//   GET  ?slug=musandam        -> { trips, trip, seats, summary, can_view_revenue }
//   POST { action, slug, ... }
//     save_settings  title, subtitle, trip_date, pickup_time, pickup_note, location,
//                    price_aed, capacity, enabled
//     add_seat       name, email?, phone?, paid, amount_aed?, note?   (cash / bank transfer)
//     mark_paid      signup_id, amount_aed?, note?
//     cancel         signup_id, reason?, refund (bool)   paid seat -> freed (+ Stripe refund);
//                    unpaid reservation -> row deleted
//     restore        signup_id                            undo a cancel that was not refunded
//     note           signup_id, note
//
// Seats only count against capacity while paid = true, so a cancel frees the
// seat the moment it is saved. Money figures are stripped for staff admins.
const { requireAdmin, safeError, canViewRevenue, createGuestMember } = require('../_lib');
const { cleanSlug } = require('../trip-status');

const TRIP_FIELDS = 'slug,title,subtitle,trip_date,pickup_time,pickup_note,location,price_aed,capacity,enabled,created_at';
const SEAT_FIELDS = 'id,trip_slug,member_id,booked_by,paid,paid_at,amount_aed,source,stripe_session_id,stripe_payment_intent,cancelled_at,cancel_reason,refund_aed,stripe_refund_id,note,created_at,updated_at';

function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

async function loadDesk(db, slug, cvr) {
  const { data: trips } = await db.from('trips').select(TRIP_FIELDS).order('trip_date', { ascending: false });
  const list = trips || [];
  const trip = list.find((t) => t.slug === slug) || list[0] || null;
  if (!trip) return { trips: [], trip: null, seats: [], summary: null, can_view_revenue: cvr };

  const { data: rows } = await db.from('trip_signups').select(SEAT_FIELDS)
    .eq('trip_slug', trip.slug).order('created_at', { ascending: true });
  const seats = rows || [];
  const ids = Array.from(new Set(seats.flatMap((s) => [s.member_id, s.booked_by]).filter(Boolean)));
  const nameOf = {};
  const memberOf = {};
  if (ids.length) {
    const { data: members } = await db.from('members').select('id,full_name,email,phone,is_guest').in('id', ids);
    (members || []).forEach((m) => { memberOf[m.id] = m; nameOf[m.id] = m.full_name || m.email || ''; });
  }
  const out = seats.map((s) => {
    const m = memberOf[s.member_id] || {};
    const guestEmail = /@padel\.lfg\.invalid$/i.test(m.email || '');
    const row = {
      id: s.id,
      member_id: s.member_id,
      name: m.full_name || (guestEmail ? 'Guest' : (m.email || 'Member')),
      email: guestEmail ? '' : (m.email || ''),
      phone: m.phone || '',
      is_guest: !!m.is_guest,
      booked_by: s.booked_by || null,
      booked_by_name: s.booked_by ? (nameOf[s.booked_by] || '') : '',
      status: s.paid ? 'paid' : (s.cancelled_at ? 'cancelled' : 'reserved'),
      paid_at: s.paid_at,
      source: s.source || 'online',
      cancelled_at: s.cancelled_at,
      cancel_reason: s.cancel_reason || '',
      refunded: !!s.stripe_refund_id || Number(s.refund_aed || 0) > 0,
      has_stripe_payment: !!s.stripe_payment_intent,
      note: s.note || '',
      created_at: s.created_at
    };
    if (cvr) { row.amount_aed = s.amount_aed; row.refund_aed = s.refund_aed; }
    return row;
  });
  const paid = out.filter((r) => r.status === 'paid');
  const summary = {
    capacity: Number(trip.capacity || 0),
    paid: paid.length,
    reserved: out.filter((r) => r.status === 'reserved').length,
    cancelled: out.filter((r) => r.status === 'cancelled').length,
    left: Math.max(0, Number(trip.capacity || 0) - paid.length)
  };
  if (cvr) {
    summary.revenue_aed = Math.round(seats.filter((s) => s.paid).reduce((t, s) => t + Number(s.amount_aed || 0), 0) * 100) / 100;
    summary.refunded_aed = Math.round(seats.reduce((t, s) => t + Number(s.refund_aed || 0), 0) * 100) / 100;
  }
  return { trips: list, trip, seats: out, summary, can_view_revenue: cvr };
}

module.exports = async (req, res) => {
  const gate = await requireAdmin(req, res);
  if (!gate) return;
  const { db, user } = gate;
  const cvr = await canViewRevenue(db, user.id);

  if (req.method === 'GET') {
    try {
      const slug = cleanSlug((req.query && req.query.slug) || 'musandam');
      return res.status(200).json(await loadDesk(db, slug, cvr));
    } catch (e) { return safeError(res, '/api/admin/trips', e, 'Could not load the trip'); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const action = str(body.action, 40);
  const slug = cleanSlug(body.slug || 'musandam');
  const now = new Date().toISOString();
  try {
    const { data: trip } = await db.from('trips').select(TRIP_FIELDS).eq('slug', slug).maybeSingle();
    if (!trip) return res.status(404).json({ error: 'No such trip' });

    if (action === 'save_settings') {
      const patch = {
        title: str(body.title, 120) || trip.title,
        subtitle: str(body.subtitle, 160) || null,
        pickup_time: /^\d{2}:\d{2}$/.test(str(body.pickup_time, 5)) ? str(body.pickup_time, 5) : trip.pickup_time,
        pickup_note: str(body.pickup_note, 300) || null,
        location: str(body.location, 120) || trip.location,
        enabled: body.enabled === true || body.enabled === 'true'
      };
      const d = str(body.trip_date, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) patch.trip_date = d;
      const price = num(body.price_aed); if (price != null && price > 0) patch.price_aed = Math.round(price * 100) / 100;
      const cap = num(body.capacity); if (cap != null && cap >= 1) patch.capacity = Math.round(cap);
      const { error } = await db.from('trips').update(patch).eq('slug', slug);
      if (error) throw error;
      return res.status(200).json(await loadDesk(db, slug, cvr));
    }

    if (action === 'add_seat') {
      const name = str(body.name, 80);
      const email = str(body.email, 120).toLowerCase();
      const phone = str(body.phone, 24).replace(/[^\d+]/g, '');
      if (!name && !email) return res.status(400).json({ error: 'A name or an email is needed.' });
      let memberId = null;
      if (email) {
        const { data: existing } = await db.from('members').select('id').ilike('email', email).limit(1);
        if (existing && existing.length) memberId = existing[0].id;
      }
      if (!memberId) {
        const made = await createGuestMember(db, { name: name || email, email: email || null, guestOf: user.id });
        memberId = made.memberId;
      }
      if (phone) await db.from('members').update({ phone: phone.startsWith('+') ? phone : (phone.startsWith('971') ? '+' + phone : '+971' + phone.replace(/^0+/, '')) }).eq('id', memberId).is('phone', null);
      const { data: already } = await db.from('trip_signups').select('id,paid').eq('trip_slug', slug).eq('member_id', memberId).maybeSingle();
      if (already && already.paid) return res.status(409).json({ error: (name || email) + ' already has a paid seat.' });
      const paid = body.paid === true || body.paid === 'true';
      const amount = num(body.amount_aed);
      const row = {
        trip_slug: slug, member_id: memberId, booked_by: null,
        paid, paid_at: paid ? now : null, source: 'manual',
        amount_aed: paid ? (amount != null ? amount : Number(trip.price_aed)) : null,
        note: str(body.note, 300) || null, cancelled_at: null, cancel_reason: null, updated_at: now
      };
      const { error } = await db.from('trip_signups').upsert(row, { onConflict: 'trip_slug,member_id' });
      if (error) throw error;
      return res.status(200).json(await loadDesk(db, slug, cvr));
    }

    const signupId = str(body.signup_id, 60);
    if (!signupId) return res.status(400).json({ error: 'signup_id required' });
    const { data: seat } = await db.from('trip_signups').select(SEAT_FIELDS).eq('id', signupId).eq('trip_slug', slug).maybeSingle();
    if (!seat) return res.status(404).json({ error: 'No such seat' });

    if (action === 'mark_paid') {
      const amount = num(body.amount_aed);
      const { error } = await db.from('trip_signups').update({
        paid: true, paid_at: now, source: seat.stripe_payment_intent ? seat.source : 'manual',
        amount_aed: amount != null ? amount : (seat.amount_aed != null ? seat.amount_aed : Number(trip.price_aed)),
        cancelled_at: null, cancel_reason: null,
        note: str(body.note, 300) || seat.note || null, updated_at: now
      }).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await loadDesk(db, slug, cvr));
    }

    if (action === 'cancel') {
      const reason = str(body.reason, 200) || null;
      if (!seat.paid) {
        // A reservation that never paid holds nothing; drop it so they can book again.
        const { error } = await db.from('trip_signups').delete().eq('id', signupId);
        if (error) throw error;
        return res.status(200).json(await loadDesk(db, slug, cvr));
      }
      const patch = { paid: false, cancelled_at: now, cancel_reason: reason, updated_at: now };
      const wantRefund = body.refund === true || body.refund === 'true';
      if (wantRefund) {
        if (!seat.stripe_payment_intent) return res.status(400).json({ error: 'This seat was not paid through Stripe, so there is nothing to refund here. Cancel without a refund and settle it by hand.' });
        if (seat.stripe_refund_id) return res.status(409).json({ error: 'This seat was already refunded.' });
        const Stripe = require('stripe');
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const amount = Math.round(Number(seat.amount_aed || trip.price_aed) * 100);
        const refund = await stripe.refunds.create({
          payment_intent: seat.stripe_payment_intent,
          amount,
          metadata: { kind: 'trip', trip_slug: slug, signup_id: signupId, by: user.id }
        });
        patch.stripe_refund_id = refund.id;
        patch.refund_aed = amount / 100;
      }
      const { error } = await db.from('trip_signups').update(patch).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await loadDesk(db, slug, cvr));
    }

    if (action === 'restore') {
      if (seat.stripe_refund_id) return res.status(409).json({ error: 'This seat was refunded; add it again as a new seat instead.' });
      const { error } = await db.from('trip_signups').update({ paid: true, paid_at: seat.paid_at || now, cancelled_at: null, cancel_reason: null, updated_at: now }).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await loadDesk(db, slug, cvr));
    }

    if (action === 'note') {
      const { error } = await db.from('trip_signups').update({ note: str(body.note, 300) || null, updated_at: now }).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await loadDesk(db, slug, cvr));
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e && e.type && /Stripe/.test(String(e.type))) return res.status(502).json({ error: 'Stripe said: ' + (e.message || 'refund failed') });
    return safeError(res, '/api/admin/trips', e, 'That did not save');
  }
};
