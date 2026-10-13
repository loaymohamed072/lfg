// GET /api/event-status?slug=<slug> - public shape of one event for /events/<slug>.
// Confirmed places = signups that are not cancelled and, on a paid event, paid.
const { admin, safeError } = require('./_lib');

function cleanSlug(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
}

const PUBLIC = 'slug,title,tagline,description,starts_at,ends_at,location,map_url,cover_url,capacity,price_aed,enabled';

async function publicEvent(db, slug) {
  const { data: ev } = await db.from('events').select(PUBLIC).eq('slug', slug).maybeSingle();
  if (!ev) return null;
  const paidEvent = ev.price_aed != null && Number(ev.price_aed) > 0;
  let q = db.from('event_signups').select('guests').eq('event_slug', slug).is('cancelled_at', null);
  if (paidEvent) q = q.eq('paid', true);
  const { data: rows } = await q;
  const taken = (rows || []).reduce((t, r) => t + 1 + Number(r.guests || 0), 0);
  const capacity = ev.capacity != null ? Number(ev.capacity) : null;
  return {
    enabled: !!ev.enabled,
    slug: ev.slug,
    title: ev.title,
    tagline: ev.tagline || null,
    description: ev.description || '',
    starts_at: ev.starts_at,
    ends_at: ev.ends_at || null,
    location: ev.location || null,
    map_url: ev.map_url || (ev.location ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.location) : null),
    cover_url: ev.cover_url || null,
    paid: paidEvent,
    price_aed: paidEvent ? Number(ev.price_aed) : 0,
    capacity,
    taken,
    spots_left: capacity != null ? Math.max(0, capacity - taken) : null,
    sold_out: capacity != null && taken >= capacity,
    past: new Date(ev.ends_at || ev.starts_at).getTime() < Date.now() - 3 * 3600 * 1000
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const slug = cleanSlug(req.query && req.query.slug);
    if (!slug) return res.status(400).json({ error: 'Missing slug' });
    const ev = await publicEvent(admin(), slug);
    if (!ev || !ev.enabled) return res.status(200).json({ enabled: false, slug });
    return res.status(200).json(ev);
  } catch (e) {
    return safeError(res, 'event-status', e, 'Could not load the event.');
  }
};
module.exports.cleanSlug = cleanSlug;
module.exports.publicEvent = publicEvent;
