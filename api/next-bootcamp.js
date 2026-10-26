// GET /api/next-bootcamp - PUBLIC, read-only. The next Sunday bootcamp for the Instagram bot
// (ManyChat External Request) and AI assistants: date, time, venue, the weekly theme the
// owner sets in the admin, spots and the price right now.
//
// Built on /api/sessions' own handler, so the booking window, cancelled Sundays and station
// balancing can never disagree with what the booking page shows.
//
// Spots: capacity grows by itself as a Sunday fills (up to max_capacity), which is why the
// booking page never prints a raw "26 left". The feed carries the numbers plus `urgency`,
// the same live signal the page uses ("Last spots in station B"), so the bot can choose.
//
// Response: { bootcamp: <Bootcamp> | null, upcoming: [{ date, weekday, theme, sold_out, urgency }] }
const sessionsHandler = require('./sessions');
const { admin, safeError, earlyWeekPromo, earlyWeekPrice, canonicalOrigin } = require('./_lib');

const DUBAI = 'Asia/Dubai';
function fmt(d, opts) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: DUBAI }, opts)).format(d); }

// Run the sessions handler in-process and capture its JSON (anonymous request).
function readSessions() {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; }
    };
    Promise.resolve(sessionsHandler({ method: 'GET', headers: {}, query: {} }, res)).catch(reject);
  });
}

function urgencyOf(s) {
  if (s.sold_out) return 'Sold out';
  const tight = (s.sections || []).filter(x => !x.full && !x.waiting && x.spots_now != null && x.spots_now <= 2).map(x => x.label);
  if (tight.length) {
    const names = tight.length > 1 ? tight.slice(0, -1).join(', ') + ' and ' + tight[tight.length - 1] : tight[0];
    return 'Last spots in ' + (tight.length > 1 ? 'stations ' : 'station ') + names;
  }
  return 'Booking open';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const [{ status, body }, promo] = await Promise.all([readSessions(), earlyWeekPromo(admin())]);
    if (status !== 200 || !body || !Array.isArray(body.sessions)) throw new Error('sessions feed unavailable (' + status + ')');

    const origin = canonicalOrigin(req);
    const listPrice = Number(process.env.SINGLE_SESSION_PRICE_AED || 99);
    const price = earlyWeekPrice(listPrice, promo);
    const priceLabel = promo.active ? 'AED ' + price + ' (' + promo.percent + '% off, booked ' + promo.days + ')' : 'AED ' + listPrice;

    const shape = (s) => {
      const start = s.start_time || '12:45:00';
      const when = new Date(s.session_date + 'T' + start + '+04:00');
      const dateLabel = fmt(when, { weekday: 'long', day: 'numeric', month: 'short' });
      const timeLabel = fmt(when, { hour: 'numeric', minute: '2-digit' });
      const location = s.location || 'CrossFit Alioth';
      const theme = s.theme || null;
      const urgency = urgencyOf(s);
      return {
        date: s.session_date,
        weekday: fmt(when, { weekday: 'long' }),
        start_time: start.slice(0, 5),
        start_time_label: timeLabel,
        starts_at: when.toISOString(),
        location,
        theme,
        booked: s.booked,
        capacity: s.capacity,
        max_capacity: s.max_capacity || s.capacity,
        capacity_grows: (s.max_capacity || 0) > s.capacity,
        spots_left: s.spots_left,
        sold_out: !!s.sold_out,
        urgency,
        price_aed: price,
        list_price_aed: listPrice,
        price_label: priceLabel,
        booking_url: origin + '/bootcamp',
        summary: dateLabel + ', ' + timeLabel + ' at ' + location + '.' + (theme ? ' Theme: ' + theme + '.' : '')
          + (s.sold_out ? ' Sold out.' : ' ' + urgency + '. ' + priceLabel + '.')
      };
    };

    const list = body.sessions;
    return res.status(200).json({
      bootcamp: list[0] ? shape(list[0]) : null,
      upcoming: list.slice(0, 4).map(s => { const x = shape(s); return { date: x.date, weekday: x.weekday, theme: x.theme, sold_out: x.sold_out, urgency: x.urgency }; })
    });
  } catch (err) {
    return safeError(res, '/api/next-bootcamp', err, 'Could not load the next bootcamp');
  }
};
