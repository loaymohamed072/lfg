// GET /api/padel-status - PUBLIC. Everything the padel page needs to render the
// live booking strip in one round trip: whether padel is on, the resolved next
// night (padel_datetime advanced in 7-day steps with a 1-hour grace, same rule
// as runs), location, owner-set price, and live spots left (capacity minus paid
// signups). padel_signups is service-role-only, so the count has to come from
// here rather than a browser Supabase read like the runs config.
const { admin, safeError } = require('./_lib');

// Advance the configured first night to the next occurrence. The grace period
// keeps tonight's event "current" while it is happening, so a payment made
// court-side lands on tonight, not next week.
//
// The grace was 1 hour, copied from the runs rule where an hour is plenty: a
// run starts, people scan in, it is over. A padel night is two hours of
// rotating rounds, so on 17 Aug the grace expired mid-event and every padel
// surface silently jumped to next week's date. The TV board went blank with
// three rounds in the database, and the scoring page would have written round
// 4 to 2026-08-24 — the read looked like data loss and the next write would
// have caused it.
//
// Six hours covers any plausible night with room either side and still rolls
// over long before the next weekly occurrence.
const GRACE_MS = 6 * 3600000;

function resolveEvent(dtIso) {
  if (!dtIso) return null;
  let t = new Date(dtIso).getTime();
  if (isNaN(t)) return null;
  const WEEK = 7 * 86400000;
  while (t + GRACE_MS < Date.now()) t += WEEK;
  const d = new Date(t);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(d);
  return { iso: d.toISOString(), ymd };
}

// Play time, written the way a player reads it: "2 hours", "90 minutes",
// "1 hour 30". Owner-set, because some weeks are 90 minutes and the page used
// to promise two hours in hardcoded copy.
function durationLabel(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return '2 hours';
  if (n < 60) return `${n} minutes`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  if (h === 1 && m === 30) return '90 minutes';
  return `${h} hour${h === 1 ? '' : 's'} ${m}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = admin();
    const { data: cfg } = await db.from('event_config')
      .select('padel_enabled, padel_datetime, padel_location, padel_price_aed, padel_capacity, padel_map_url, padel_tagline, padel_duration_min')
      .eq('id', 1).maybeSingle();
    if (!cfg || !cfg.padel_enabled || !cfg.padel_datetime) {
      return res.status(200).json({ enabled: false });
    }
    const ev = resolveEvent(cfg.padel_datetime);
    if (!ev) return res.status(200).json({ enabled: false });

    const { count } = await db.from('padel_signups')
      .select('member_id', { count: 'exact', head: true })
      .eq('event_date', ev.ymd).eq('paid', true);
    const capacity = Number(cfg.padel_capacity || 16);
    const paid = count || 0;

    return res.status(200).json({
      enabled: true,
      event_iso: ev.iso,
      event_date: ev.ymd,
      location: cfg.padel_location || 'Dubai',
      price_aed: Number(cfg.padel_price_aed || 0),
      capacity,
      paid_count: paid,
      spots_left: Math.max(0, capacity - paid),
      map_url: cfg.padel_map_url || null,
      tagline: cfg.padel_tagline || null,
      duration_min: Number(cfg.padel_duration_min || 120),
      duration_label: durationLabel(cfg.padel_duration_min)
    });
  } catch (e) {
    return safeError(res, 'padel-status', e, 'Could not load the padel night.');
  }
};

module.exports.resolveEvent = resolveEvent;
module.exports.durationLabel = durationLabel;
