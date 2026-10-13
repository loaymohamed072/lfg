// /api/admin/events - events desk. Admin only.
//   GET  [?slug=]  -> { events: [...], event, signups, summary, can_view_revenue }
//   POST { action, ... }
//     save         slug?, title, tagline, description, starts_at, ends_at, location, map_url,
//                  capacity (blank = none), price_aed (blank = free), enabled   (creates when slug is new)
//     upload_cover slug, image_base64, content_type
//     add_signup   slug, name, email?, phone?, guests?, paid?, amount_aed?, note?
//     mark_paid    slug, signup_id, amount_aed?
//     cancel       slug, signup_id, reason?, refund (bool; Stripe-paid only)
//     restore      slug, signup_id
//     note         slug, signup_id, note
//     delete       slug   (only when nobody signed up)
const { requireAdmin, safeError, canViewRevenue, authService } = require('../_lib');
const { cleanSlug } = require('../event-status');

const EV = 'slug,title,tagline,description,starts_at,ends_at,location,map_url,cover_url,cover_small_url,capacity,price_aed,enabled,created_at,updated_at';
const SU = 'id,event_slug,member_id,name,email,phone,guests,paid,paid_at,amount_aed,stripe_session_id,stripe_payment_intent,source,cancelled_at,cancel_reason,note,created_at,updated_at';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }
function num(v) { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function slugify(v) { return String(v || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60); }
function isoOrNull(v) { const s = str(v, 40); if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }

async function desk(db, slug, cvr) {
  const { data: events } = await db.from('events').select(EV).order('starts_at', { ascending: false });
  const list = events || [];
  const counts = {};
  const { data: allSignups } = await db.from('event_signups').select('event_slug,guests,paid,cancelled_at');
  (allSignups || []).forEach((s) => {
    const c = counts[s.event_slug] || (counts[s.event_slug] = { going: 0, pending: 0 });
    if (s.cancelled_at) return;
    const ev = list.find((e) => e.slug === s.event_slug);
    const paidEvent = ev && ev.price_aed != null && Number(ev.price_aed) > 0;
    if (paidEvent && !s.paid) c.pending += 1 + Number(s.guests || 0); else c.going += 1 + Number(s.guests || 0);
  });
  const events_out = list.map((e) => Object.assign({}, e, { going: (counts[e.slug] || {}).going || 0, pending: (counts[e.slug] || {}).pending || 0 }));
  const event = list.find((e) => e.slug === slug) || list[0] || null;
  if (!event) return { events: events_out, event: null, signups: [], summary: null, can_view_revenue: cvr };
  const paidEvent = event.price_aed != null && Number(event.price_aed) > 0;
  const { data: rows } = await db.from('event_signups').select(SU).eq('event_slug', event.slug).order('created_at', { ascending: true });
  const signups = (rows || []).map((s) => {
    const row = {
      id: s.id, name: s.name, email: s.email, phone: s.phone || '', guests: Number(s.guests || 0),
      status: s.cancelled_at ? 'cancelled' : (paidEvent ? (s.paid ? 'paid' : 'reserved') : 'going'),
      paid_at: s.paid_at, source: s.source || 'online', cancelled_at: s.cancelled_at, cancel_reason: s.cancel_reason || '',
      has_stripe_payment: !!s.stripe_payment_intent, note: s.note || '', created_at: s.created_at
    };
    if (cvr) row.amount_aed = s.amount_aed;
    return row;
  });
  const live = signups.filter((r) => r.status === 'going' || r.status === 'paid');
  const summary = {
    paid_event: paidEvent,
    capacity: event.capacity != null ? Number(event.capacity) : null,
    going: live.reduce((t, r) => t + 1 + r.guests, 0),
    people: live.length,
    reserved: signups.filter((r) => r.status === 'reserved').reduce((t, r) => t + 1 + r.guests, 0),
    cancelled: signups.filter((r) => r.status === 'cancelled').length
  };
  summary.left = summary.capacity != null ? Math.max(0, summary.capacity - summary.going) : null;
  if (cvr && paidEvent) summary.revenue_aed = Math.round((rows || []).filter((s) => s.paid && !s.cancelled_at).reduce((t, s) => t + Number(s.amount_aed || 0), 0) * 100) / 100;
  return { events: events_out, event, signups, summary, can_view_revenue: cvr };
}

module.exports = async (req, res) => {
  const gate = await requireAdmin(req, res);
  if (!gate) return;
  const { db, user } = gate;
  const cvr = await canViewRevenue(db, user.id);
  if (req.method === 'GET') {
    try { return res.status(200).json(await desk(db, cleanSlug(req.query && req.query.slug), cvr)); }
    catch (e) { return safeError(res, '/api/admin/events', e, 'Could not load events'); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  const action = str(body.action, 40);
  const now = new Date().toISOString();
  try {
    if (action === 'save') {
      const title = str(body.title, 120);
      if (!title) return res.status(400).json({ error: 'The event needs a title.' });
      const startsAt = isoOrNull(body.starts_at);
      if (!startsAt) return res.status(400).json({ error: 'Pick a date and time.' });
      let slug = cleanSlug(body.slug) || slugify(title);
      if (!slug) return res.status(400).json({ error: 'Could not make a web address from that title.' });
      const { data: existing } = await db.from('events').select('slug').eq('slug', slug).maybeSingle();
      const patch = {
        title, tagline: str(body.tagline, 160) || null, description: str(body.description, 4000) || null,
        starts_at: startsAt, ends_at: isoOrNull(body.ends_at),
        location: str(body.location, 160) || null, map_url: /^https?:\/\//.test(str(body.map_url, 400)) ? str(body.map_url, 400) : null,
        capacity: num(body.capacity) != null && num(body.capacity) >= 1 ? Math.round(num(body.capacity)) : null,
        price_aed: num(body.price_aed) != null && num(body.price_aed) > 0 ? Math.round(num(body.price_aed) * 100) / 100 : null,
        enabled: body.enabled === true || body.enabled === 'true', updated_at: now
      };
      if (patch.ends_at && new Date(patch.ends_at) <= new Date(startsAt)) patch.ends_at = null;
      if (existing) { const { error } = await db.from('events').update(patch).eq('slug', slug); if (error) throw error; }
      else { const { error } = await db.from('events').insert(Object.assign({ slug }, patch)); if (error) throw error; }
      return res.status(200).json(await desk(db, slug, cvr));
    }

    const slug = cleanSlug(body.slug);
    const { data: event } = slug ? await db.from('events').select(EV).eq('slug', slug).maybeSingle() : { data: null };
    if (!event) return res.status(404).json({ error: 'No such event' });

    if (action === 'upload_cover') {
      const ct = String(body.content_type || 'image/jpeg').toLowerCase();
      const b64 = String(body.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
      if (!EXT[ct]) return res.status(400).json({ error: 'Use a JPG, PNG or WebP image' });
      let buffer; try { buffer = Buffer.from(b64, 'base64'); } catch (_) { return res.status(400).json({ error: 'Bad image data' }); }
      if (!buffer.length) return res.status(400).json({ error: 'Empty image' });
      if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 8MB)' });
      const stamp = Date.now();
      const storage = authService().storage.from('bootcamp-photos');
      const path = 'events/' + slug + '-' + stamp + '.' + EXT[ct];
      const up = await storage.upload(path, buffer, { contentType: ct, upsert: true });
      if (up.error) throw new Error(up.error.message);
      const { data: pub } = storage.getPublicUrl(path);
      let smallUrl = null;
      const sb64 = String(body.image_small_base64 || '').replace(/^data:[^;]+;base64,/, '');
      if (sb64) {
        let sbuf = null; try { sbuf = Buffer.from(sb64, 'base64'); } catch (_) { sbuf = null; }
        if (sbuf && sbuf.length && sbuf.length <= 8 * 1024 * 1024) {
          const spath = 'events/' + slug + '-' + stamp + '-800.' + EXT[ct];
          const sup = await storage.upload(spath, sbuf, { contentType: ct, upsert: true });
          if (!sup.error) smallUrl = storage.getPublicUrl(spath).data.publicUrl;
        }
      }
      const { error } = await db.from('events').update({ cover_url: pub.publicUrl, cover_small_url: smallUrl, updated_at: now }).eq('slug', slug);
      if (error) throw error;
      return res.status(200).json(await desk(db, slug, cvr));
    }

    if (action === 'delete') {
      const { count } = await db.from('event_signups').select('id', { count: 'exact', head: true }).eq('event_slug', slug);
      if (count) return res.status(409).json({ error: 'People signed up for this one; switch it off instead of deleting it.' });
      const { error } = await db.from('events').delete().eq('slug', slug);
      if (error) throw error;
      return res.status(200).json(await desk(db, '', cvr));
    }

    const paidEvent = event.price_aed != null && Number(event.price_aed) > 0;

    if (action === 'add_signup') {
      const name = str(body.name, 80), email = str(body.email, 120).toLowerCase();
      if (!name) return res.status(400).json({ error: 'A name is needed.' });
      const key = email || ('walk-in-' + Date.now().toString(36) + '@events.lfg.invalid');
      const paid = paidEvent && (body.paid === true || body.paid === 'true');
      const amount = num(body.amount_aed);
      const guests = Math.max(0, Math.min(10, parseInt(body.guests, 10) || 0));
      const row = {
        event_slug: slug, name, email: key, phone: str(body.phone, 24) || null, guests,
        paid, paid_at: paid ? now : null, source: 'manual',
        amount_aed: paid ? (amount != null ? amount : Number(event.price_aed) * (1 + guests)) : null,
        note: str(body.note, 300) || null, cancelled_at: null, cancel_reason: null, updated_at: now
      };
      const { error } = await db.from('event_signups').upsert(row, { onConflict: 'event_slug,email' });
      if (error) throw error;
      return res.status(200).json(await desk(db, slug, cvr));
    }

    const signupId = str(body.signup_id, 60);
    if (!signupId) return res.status(400).json({ error: 'signup_id required' });
    const { data: su } = await db.from('event_signups').select(SU).eq('id', signupId).eq('event_slug', slug).maybeSingle();
    if (!su) return res.status(404).json({ error: 'No such sign-up' });

    if (action === 'mark_paid') {
      const amount = num(body.amount_aed);
      const { error } = await db.from('event_signups').update({
        paid: true, paid_at: now, source: su.stripe_payment_intent ? su.source : 'manual',
        amount_aed: amount != null ? amount : (su.amount_aed != null ? su.amount_aed : Number(event.price_aed || 0) * (1 + Number(su.guests || 0))),
        cancelled_at: null, cancel_reason: null, updated_at: now
      }).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await desk(db, slug, cvr));
    }
    if (action === 'cancel') {
      const reason = str(body.reason, 200) || null;
      if (paidEvent && !su.paid) {
        const { error } = await db.from('event_signups').delete().eq('id', signupId);
        if (error) throw error;
        return res.status(200).json(await desk(db, slug, cvr));
      }
      const patch = { cancelled_at: now, cancel_reason: reason, updated_at: now };
      if (su.paid) patch.paid = false;
      if (body.refund === true || body.refund === 'true') {
        if (!su.stripe_payment_intent) return res.status(400).json({ error: 'Not paid through Stripe, nothing to refund here.' });
        const Stripe = require('stripe');
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const amount = Math.round(Number(su.amount_aed || 0) * 100);
        const refund = await stripe.refunds.create({ payment_intent: su.stripe_payment_intent, amount: amount || undefined, metadata: { kind: 'event', event_slug: slug, signup_id: signupId, by: user.id } });
        patch.note = ((su.note ? su.note + ' · ' : '') + 'refunded ' + (refund.amount / 100) + ' AED (' + refund.id + ')').slice(0, 300);
      }
      const { error } = await db.from('event_signups').update(patch).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await desk(db, slug, cvr));
    }
    if (action === 'restore') {
      if (/refunded/.test(su.note || '')) return res.status(409).json({ error: 'This one was refunded; add them again instead.' });
      const { error } = await db.from('event_signups').update({ cancelled_at: null, cancel_reason: null, paid: paidEvent ? true : false, paid_at: paidEvent ? (su.paid_at || now) : null, updated_at: now }).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await desk(db, slug, cvr));
    }
    if (action === 'note') {
      const { error } = await db.from('event_signups').update({ note: str(body.note, 300) || null, updated_at: now }).eq('id', signupId);
      if (error) throw error;
      return res.status(200).json(await desk(db, slug, cvr));
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    if (e && e.type && /Stripe/.test(String(e.type))) return res.status(502).json({ error: 'Stripe said: ' + (e.message || 'refund failed') });
    return safeError(res, '/api/admin/events', e, 'That did not save');
  }
};
