// GET /api/next-run - PUBLIC, read-only. The next upcoming LFG run, computed from the same
// event_config row the homepage reads (weekly main run + optional Saturday run), so the
// Instagram DM bot (ManyChat External Request) answers "when and where is the next run?"
// without anyone updating a second place.
//
// Response (JSON):
//   { run: <Run> | null, upcoming: [<Run>...] }
//   Run = { date, weekday, start_time, start_time_label, starts_at, type, location,
//           map_url, price_aed, price_label, booking_url, tagline, summary }
//   type is 'paid_track' when the owner flagged the main run as paid (event_config.run_paid),
//   otherwise 'free_run'. booking_url is /track for a paid run, /#register-form for a free one.
//
// Same schedule rule as the pages: a run stays "next" until one hour after it starts, then
// rolls forward a week. No login, no personal data, cached for a minute at the edge.
const { admin, safeError, canonicalOrigin } = require('./_lib');

const DUBAI = 'Asia/Dubai';

// Advance a weekly anchor to its next occurrence (1-hour grace, mirrors the pages).
function advanceIfPast(dtStr) {
  if (!dtStr) return null;
  let t = new Date(dtStr);
  if (isNaN(t.getTime())) return null;
  const now = Date.now();
  let guard = 0;
  while (t.getTime() + 3600000 < now && guard++ < 520) t = new Date(t.getTime() + 7 * 86400000);
  return t;
}

// Without an admin link, search Maps for the location itself, never an older venue's link.
function mapsSearch(loc) { const l = String(loc || '').trim(); return l ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(/dubai/i.test(l) ? l : l + ', Dubai') : null; }

function fmt(d, opts) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: DUBAI }, opts)).format(d); }
function ymd(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: DUBAI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function hm24(d) { return new Intl.DateTimeFormat('en-GB', { timeZone: DUBAI, hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }

function buildRun({ when, location, mapUrl, paid, priceAed, tagline, origin }) {
  const price = paid ? Number(priceAed != null ? priceAed : 30) : 0;
  const weekday = fmt(when, { weekday: 'long' });
  const dateLabel = fmt(when, { weekday: 'long', day: 'numeric', month: 'short' });
  const timeLabel = fmt(when, { hour: 'numeric', minute: '2-digit' });
  const loc = location || 'Dubai';
  const what = paid ? 'Paid intervals session' : 'Free community run';
  return {
    date: ymd(when),
    weekday,
    start_time: hm24(when),
    start_time_label: timeLabel,
    starts_at: when.toISOString(),
    type: paid ? 'paid_track' : 'free_run',
    location: loc,
    map_url: /^https:\/\//i.test(mapUrl || '') ? mapUrl : mapsSearch(location),
    price_aed: price,
    price_label: paid ? 'AED ' + price : 'Free',
    booking_url: origin + (paid ? '/track' : '/#register-form'),
    tagline: tagline || null,
    summary: dateLabel + ', ' + timeLabel + ' at ' + loc + '. ' + what + (paid ? ', AED ' + price + '.' : '.')
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  try {
    const db = admin();
    const { data: cfg, error } = await db.from('event_config')
      .select('event_datetime,location,run_map_url,run_tagline,run_paid,run_price_aed,saturday_enabled,saturday_datetime,saturday_location')
      .eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!cfg) return res.status(200).json({ run: null, upcoming: [] });

    const origin = canonicalOrigin(req);
    const runs = [];
    const main = advanceIfPast(cfg.event_datetime);
    if (main) runs.push(buildRun({ when: main, location: cfg.location, mapUrl: cfg.run_map_url, paid: !!cfg.run_paid, priceAed: cfg.run_price_aed, tagline: cfg.run_tagline, origin }));
    if (cfg.saturday_enabled && cfg.saturday_datetime) {
      const sat = advanceIfPast(cfg.saturday_datetime);
      if (sat) runs.push(buildRun({ when: sat, location: cfg.saturday_location, mapUrl: null, paid: false, priceAed: 0, tagline: null, origin }));
    }
    runs.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return res.status(200).json({ run: runs[0] || null, upcoming: runs });
  } catch (err) {
    return safeError(res, '/api/next-run', err, 'Could not load the next run');
  }
};
