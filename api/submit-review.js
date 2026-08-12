// POST /api/submit-review - public endpoint for member-submitted reviews.
// Stores with status='pending'; admin manually approves before they appear on
// the site (admin approval UI is in a follow-up sprint).
//
// Hardened the same way /api/run-register is:
//   - honeypot field (`website_url`)
//   - per-IP rate limit (3 reviews per hour per IP) using a process-global
//     bucket so dev-server hot-reload doesn't wipe it
//   - server-side validation: rating 1-5, name 1-80, email optional+regex,
//     comment 20-2000
const { admin } = require('./_lib');

const RATE_LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;
const bucket = (global.__lfgReviewBucket = global.__lfgReviewBucket || new Map());

function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const e = bucket.get(ip);
  if (!e || e.resetAt < now) { bucket.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  e.count++;
  return e.count > RATE_LIMIT;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || null;
}

function clean(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};

  // Honeypot - silent accept so bots don't learn.
  if (clean(body.website_url, 1)) return res.status(200).json({ ok: true });

  const ip = clientIp(req);
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many reviews from this network. Try again later.' });

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Pick a rating between 1 and 5 stars' });
  }
  const name = clean(body.name, 80);
  if (!name || name.length < 2) return res.status(400).json({ error: 'Add your name' });
  const comment = clean(body.comment, 2000);
  if (!comment || comment.length < 20) return res.status(400).json({ error: 'Reviews should be at least a sentence (20+ chars)' });

  let email = null;
  if (body.email) {
    const e = clean(body.email, 320);
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) email = e.toLowerCase();
    // Invalid email is silently ignored (it's optional)
  }

  try {
    const db = admin();
    const { error } = await db.from('reviews').insert({
      rating, name, email, comment, status: 'pending', client_ip: ip
    });
    if (error) {
      console.error('[/api/submit-review] insert:', error.message);
      return res.status(500).json({ error: 'Could not save review' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[/api/submit-review]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
