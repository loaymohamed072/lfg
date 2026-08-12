// POST /api/send-login-link - sends a branded LFG sign-in email via Resend instead
// of Supabase's default (unbranded, pm-bounces) magic-link email.
// Body: { email, next? }
// We generate a Supabase magic link with the admin API, then deliver it through our
// own on-brand email. Always returns { ok: true } so we never leak whether an email
// is registered. Per-IP + per-email rate limited to stop abuse.
const { admin, authService, ensureMember, canonicalOrigin, buildAuthLink } = require('./_lib');
const { sendLoginLink } = require('./_email');

// Only these internal paths can be the post-login destination.
const ALLOWED_NEXT = new Set(['/', '/account', '/bootcamp.html', '/leaderboard', '/run-checkin', '/checkin', '/shop']);

const bucket = (global.__lfgLoginLinkBucket = global.__lfgLoginLinkBucket || new Map());
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_KEY = 5;
function limited(key) {
  if (!key) return false;
  const now = Date.now();
  const e = bucket.get(key);
  if (!e || e.resetAt < now) { bucket.set(key, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  e.count++;
  return e.count > MAX_PER_KEY;
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || null;
}
function cleanEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  const email = cleanEmail(body.email);
  if (!email) return res.status(400).json({ error: 'A valid email is required' });

  const ip = clientIp(req);
  // Rate limit on both IP and email so neither a single user nor a single inbox can be spammed.
  if (limited('ip:' + ip) || limited('em:' + email)) {
    return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
  }

  const rawNext = typeof body.next === 'string' ? body.next : '';
  const nextPath = ALLOWED_NEXT.has(rawNext.split('?')[0].split('#')[0]) ? rawNext : '/account';
  const origin = canonicalOrigin(req);

  try {
    const auth = authService();
    async function makeLink() {
      return auth.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: origin + nextPath } });
    }
    let { data, error } = await makeLink();

    // If the email has no account yet, create a passwordless one and retry (mirrors
    // Supabase's default "create on first magic link" behaviour).
    if (error && /not\s*found|no\s*user|does not exist/i.test(error.message || '')) {
      const { data: created } = await auth.auth.admin.createUser({ email, email_confirm: true });
      if (created && created.user) {
        try { await admin().from('members').upsert({ id: created.user.id, email }, { onConflict: 'id' }); } catch (e) {}
      }
      ({ data, error } = await makeLink());
    }

    const magicUrl = buildAuthLink(origin, data, nextPath);
    if (error || !magicUrl) {
      console.warn('[send-login-link] generateLink failed:', error && error.message);
      // Don't reveal anything to the caller; pretend success.
      return res.status(200).json({ ok: true });
    }

    // The 6-digit code lets phone-app (PWA) users sign in without leaving the app.
    const code = (data && data.properties && data.properties.email_otp) || null;
    const r = await sendLoginLink({ email, magicUrl, code });
    if (!r.ok) console.warn('[send-login-link] email send skipped:', r.error);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[/api/send-login-link]', e);
    // Still return ok to avoid leaking account existence / internals.
    return res.status(200).json({ ok: true });
  }
};
