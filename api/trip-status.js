// GET /api/trip-status?slug=musandam - PUBLIC. Everything the trip page needs to
// render its booking plate in one round trip: whether bookings are open, the
// date, pick-up time, owner-set price, and live spots left (capacity minus PAID
// seats). trip_signups is service-role only, so the count comes from here.
const { admin, safeError } = require('./_lib');

function cleanSlug(v) {
  return String(v || 'musandam').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'musandam';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = admin();
    const slug = cleanSlug(req.query && req.query.slug);
    const { data: trip } = await db.from('trips')
      .select('slug, title, subtitle, trip_date, pickup_time, pickup_note, location, price_aed, capacity, enabled')
      .eq('slug', slug).maybeSingle();
    if (!trip || !trip.enabled) return res.status(200).json({ enabled: false });

    const { count } = await db.from('trip_signups')
      .select('id', { count: 'exact', head: true })
      .eq('trip_slug', slug).eq('paid', true);
    const capacity = Number(trip.capacity || 20);
    const paid = count || 0;
    const pickup = /^\d{2}:\d{2}$/.test(trip.pickup_time || '') ? trip.pickup_time : '06:00';
    // Pick-up in Dubai time, as an instant the page and the schema can both read.
    const tripIso = new Date(trip.trip_date + 'T' + pickup + ':00+04:00').toISOString();

    return res.status(200).json({
      enabled: true,
      slug: trip.slug,
      title: trip.title,
      subtitle: trip.subtitle || null,
      trip_date: trip.trip_date,
      trip_iso: tripIso,
      pickup_time: pickup,
      pickup_note: trip.pickup_note || null,
      location: trip.location || 'Musandam, Oman',
      price_aed: Number(trip.price_aed || 0),
      capacity,
      paid_count: paid,
      spots_left: Math.max(0, capacity - paid),
      past: trip.trip_date < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
    });
  } catch (e) {
    return safeError(res, 'trip-status', e, 'Could not load the trip.');
  }
};
module.exports.cleanSlug = cleanSlug;
