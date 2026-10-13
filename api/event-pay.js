// /api/event-pay - PAID event booking, no account needed.
//   POST { slug, name, email, phone?, guests? } -> Stripe embedded checkout
//        (one place for the buyer plus their guests on one payment)
//   GET  ?session_id=cs_... -> { status, payment_status } for the page's verify step
// Price and capacity come from the events row, never the client. The signup row is
// written unpaid now and flipped to paid by the webhook (fulfilment in _lib.js).
const { admin, safeError } = require('./_lib');
const { cleanSlug, publicEvent } = require('./event-status');
const Stripe = require('stripe');

function str(v, max) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max); }
function toE164(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.charAt(0) === '+') return '+' + s.slice(1).replace(/[^\d]/g, '');
  const d = s.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!d) return null;
  return d.indexOf('971') === 0 ? '+' + d : '+971' + d;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function dubaiLine(iso) {
  try { return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }); } catch (e) { return iso; }
}

module.exports = async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Payments are not configured.' });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  if (req.method === 'GET') {
    const sid = req.query && req.query.session_id;
    if (!sid) return res.status(400).json({ error: 'Missing session_id' });
    try {
      const s = await stripe.checkout.sessions.retrieve(String(sid));
      return res.status(200).json({ status: s.status, payment_status: s.payment_status });
    } catch (e) { return res.status(400).json({ error: 'Could not retrieve session' }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const slug = cleanSlug(body.slug);
  const name = str(body.name, 80);
  const email = str(body.email, 120).toLowerCase();
  const phone = toE164(body.phone);
  const guests = Math.max(0, Math.min(5, parseInt(body.guests, 10) || 0));
  if (!slug) return res.status(400).json({ error: 'Missing event' });
  if (!name) return res.status(400).json({ error: 'Your name, so we know who is coming.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A real email, the receipt and confirmation go there.' });
  try {
    const db = admin();
    const ev = await publicEvent(db, slug);
    if (!ev || !ev.enabled) return res.status(404).json({ error: 'This event is not open.' });
    if (ev.past) return res.status(409).json({ error: 'This one has already happened.', past: true });
    if (!ev.paid) return res.status(400).json({ error: 'This event is free; use the sign-up on the page.', free: true });

    const { data: existing } = await db.from('event_signups').select('id,paid,guests,cancelled_at')
      .eq('event_slug', slug).eq('email', email).maybeSingle();
    if (existing && existing.paid && !existing.cancelled_at) return res.status(409).json({ already_paid: true, error: 'You already have a place for this one.' });
    const places = 1 + guests;
    if (ev.capacity != null && ev.taken + places > ev.capacity) {
      const left = Math.max(0, ev.capacity - ev.taken);
      return res.status(409).json({ sold_out: left === 0, spots_left: left,
        error: left === 0 ? 'All places are taken.' : 'Only ' + left + (left === 1 ? ' place is' : ' places are') + ' left.' });
    }
    const { data: member } = await db.from('members').select('id').ilike('email', email.replace(/[%_\\]/g, '\\$&')).limit(1);
    const memberId = member && member.length ? member[0].id : null;
    const now = new Date().toISOString();
    const amount = Math.round(Number(ev.price_aed) * places * 100) / 100;
    const { data: row, error: rowErr } = await db.from('event_signups').upsert(
      { event_slug: slug, member_id: memberId, name, email, phone, guests, paid: false, source: 'online',
        amount_aed: amount, cancelled_at: null, cancel_reason: null, updated_at: now },
      { onConflict: 'event_slug,email' }
    ).select('id').single();
    if (rowErr) throw rowErr;

    let pay = null;
    if (memberId) {
      const { data: p } = await db.from('payments').insert({
        member_id: memberId, kind: 'event', amount_aed: amount, status: 'pending', created_at: now
      }).select('id').single();
      pay = p || null;
    }
    const metadata = {
      kind: 'event', event_slug: slug, signup_id: row.id, member_id: memberId || '', email, name,
      places: String(places), payment_id: pay ? pay.id : ''
    };
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      mode: 'payment',
      branding_settings: { background_color: '#0a0a0a', button_color: '#B3B38A', border_style: 'rectangular' },
      line_items: [{
        quantity: places,
        price_data: {
          currency: 'aed',
          unit_amount: Math.round(Number(ev.price_aed) * 100),
          product_data: { name: ev.title, description: dubaiLine(ev.starts_at) + (ev.location ? ' · ' + ev.location : '') + (places > 1 ? ' · ' + places + ' places' : '') }
        }
      }],
      customer_email: email,
      metadata,
      payment_method_types: ['card'],
      redirect_on_completion: 'never'
    });
    await db.from('event_signups').update({ stripe_session_id: session.id, updated_at: now }).eq('id', row.id);
    if (pay) await db.from('payments').update({ stripe_session_id: session.id }).eq('id', pay.id);
    return res.status(200).json({ client_secret: session.client_secret, id: session.id, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY, places, amount_aed: amount });
  } catch (e) {
    return safeError(res, 'event-pay', e, 'Could not start the booking. Try again.');
  }
};
