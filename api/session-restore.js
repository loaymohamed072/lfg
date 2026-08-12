// POST /api/session-restore - keeps members signed in past Safari's 7-day
// localStorage eviction (ITP). A server-set httpOnly cookie (which ITP does not
// clear) backs a row in auth_remember_tokens; when the browser has lost its
// Supabase session, the client calls action:"restore" and gets a fresh session
// minted server-side (generateLink + verifyOtp - no email is ever sent).
//
// Actions (body.action):
//   register - Bearer token required. Mints a device cookie for the signed-in
//              member. If the device already has a valid cookie, just extends it.
//   restore  - Cookie required. Returns { access_token, refresh_token } and
//              rotates the cookie secret.
//   forget   - Deletes the row and clears the cookie (sign-out path).
//
// Cookie: lfg_rm=<rowId>.<secret>  HttpOnly Secure SameSite=Lax Max-Age=1y
// Secret is 256-bit random; only its SHA-256 is stored. Compare is timing-safe.
const crypto = require('crypto');
const { admin, authService } = require('./_lib');
const { createClient } = require('@supabase/supabase-js');

const COOKIE = 'lfg_rm';
// 180 days, and it slides: every visit pushes the expiry back out. A member who
// turns up even once every few months never sees a login screen. A year was
// hard to justify against the proportionality rule regulators apply to
// persistent login cookies (WP194 §2.3), and buys nothing for an active member.
const MAX_AGE = 180 * 24 * 60 * 60; // seconds

// Per-IP rate limit (same shape as send-login-link).
const bucket = (global.__lfgRestoreBucket = global.__lfgRestoreBucket || new Map());
const WINDOW_MS = 15 * 60 * 1000;
// Generous on purpose. At a run, 40+ members scan the QR from the same venue wifi
// or carrier NAT, so they all share one IP; a tight per-IP limit would start
// refusing genuine check-ins mid-event. The real protection is the 256-bit cookie
// secret, which is not brute-forceable - this cap only stops runaway retry loops.
const MAX_PER_KEY = 300;
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

function sha256(v) { return crypto.createHash('sha256').update(v).digest('hex'); }

function parseCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [id, secret] = decodeURIComponent(m[1]).split('.');
  if (!id || !secret || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { id, secret };
}

function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie',
    COOKIE + '=' + encodeURIComponent(value) +
    '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + maxAge);
}

function hashEq(storedHex, candidateHex) {
  if (!storedHex) return false;
  const a = Buffer.from(storedHex, 'hex');
  const b = Buffer.from(candidateHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns { row, matchedHash } or null. Accepts the current secret, or the
// immediately-previous one while its grace window is open (see migration
// auth_remember_tokens_rotation_grace for why).
async function findValidRow(db, cookie) {
  if (!cookie) return null;
  const { data: row } = await db.from('auth_remember_tokens')
    .select('id, member_id, token_hash, prev_token_hash, prev_valid_until, last_rotated_at, expires_at')
    .eq('id', cookie.id).maybeSingle();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  const candidate = sha256(cookie.secret);
  if (hashEq(row.token_hash, candidate)) return { row, via: 'current' };
  const graceOpen = row.prev_valid_until && new Date(row.prev_valid_until) > new Date();
  if (graceOpen && hashEq(row.prev_token_hash, candidate)) return { row, via: 'grace' };
  return null;
}

const GRACE_MS = 2 * 60 * 1000;          // how long the outgoing secret stays valid
const ROTATE_AFTER_MS = 24 * 60 * 60 * 1000; // how often the secret actually changes

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (limited('ip:' + clientIp(req))) return res.status(429).json({ error: 'Too many requests' });

  const action = (req.body && req.body.action) || 'restore';
  const db = admin();
  const auth = authService();

  if (action === 'register') {
    const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: 'Unauthorized' });
    const { data: userRes, error } = await auth.auth.getUser(m[1]);
    if (error || !userRes || !userRes.user) return res.status(401).json({ error: 'Unauthorized' });
    const memberId = userRes.user.id;

    // Device already remembered? Just extend, don't pile up rows.
    const cookie = parseCookie(req);
    const existing = await findValidRow(db, cookie);
    if (existing && existing.row.member_id === memberId) {
      const expiresAt = new Date(Date.now() + MAX_AGE * 1000).toISOString();
      await db.from('auth_remember_tokens').update({ expires_at: expiresAt }).eq('id', existing.row.id);
      setCookie(res, cookie.id + '.' + cookie.secret, MAX_AGE);
      return res.status(200).json({ ok: true });
    }

    const secret = crypto.randomBytes(32).toString('base64url');
    const { data: row, error: insErr } = await db.from('auth_remember_tokens')
      .insert({
        member_id: memberId,
        token_hash: sha256(secret),
        user_agent: (req.headers['user-agent'] || '').slice(0, 300)
      })
      .select('id').single();
    if (insErr || !row) return res.status(500).json({ error: 'Could not save' });
    setCookie(res, row.id + '.' + secret, MAX_AGE);
    return res.status(200).json({ ok: true });
  }

  if (action === 'forget') {
    const cookie = parseCookie(req);
    if (cookie) await db.from('auth_remember_tokens').delete().eq('id', cookie.id);
    setCookie(res, '', 0);
    return res.status(200).json({ ok: true });
  }

  // restore
  const restoreCookie = parseCookie(req);
  const match = await findValidRow(db, restoreCookie);
  if (!match) { setCookie(res, '', 0); return res.status(401).json({ error: 'Unauthorized' }); }
  const row = match.row;
  const cookieSecret = restoreCookie.secret;

  const { data: userRes, error: userErr } = await auth.auth.admin.getUserById(row.member_id);
  if (userErr || !userRes || !userRes.user || !userRes.user.email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Mint a fresh session: generate a magic link, consume its hash right here.
  // No email is sent and the link never leaves the server.
  const { data: link, error: linkErr } = await auth.auth.admin.generateLink({
    type: 'magiclink', email: userRes.user.email
  });
  const tokenHash = link && link.properties && link.properties.hashed_token;
  if (linkErr || !tokenHash) return res.status(401).json({ error: 'Unauthorized' });

  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: verified, error: verErr } = await anon.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (verErr || !verified || !verified.session) return res.status(401).json({ error: 'Unauthorized' });

  // Rotate on a cadence, not every call. Rotating per-restore meant concurrent
  // requests each minted a different secret and orphaned each other's cookie.
  // A grace-window match always rotates, because the current secret is stored
  // only as a hash - we cannot hand it back, so we must issue a fresh one.
  const now = Date.now();
  const stale = !row.last_rotated_at || (now - new Date(row.last_rotated_at).getTime()) > ROTATE_AFTER_MS;
  const expiresAt = new Date(now + MAX_AGE * 1000).toISOString();

  if (stale || match.via === 'grace') {
    const newSecret = crypto.randomBytes(32).toString('base64url');
    await db.from('auth_remember_tokens').update({
      token_hash: sha256(newSecret),
      // The secret being retired is whatever was CURRENT, never merely the one
      // we matched - otherwise a grace hit drops the freshly-issued secret out
      // of the chain and logs that device out on its next call.
      prev_token_hash: row.token_hash,
      prev_valid_until: new Date(now + GRACE_MS).toISOString(),
      last_rotated_at: new Date(now).toISOString(),
      last_used_at: new Date(now).toISOString(),
      expires_at: expiresAt
    }).eq('id', row.id);
    setCookie(res, row.id + '.' + newSecret, MAX_AGE);
  } else {
    await db.from('auth_remember_tokens').update({
      last_used_at: new Date(now).toISOString(),
      expires_at: expiresAt
    }).eq('id', row.id);
    // Re-send the same secret so the cookie's Max-Age keeps sliding forward.
    setCookie(res, row.id + '.' + cookieSecret, MAX_AGE);
  }

  // Opportunistic cleanup of this member's expired rows.
  db.from('auth_remember_tokens').delete()
    .eq('member_id', row.member_id).lt('expires_at', new Date().toISOString())
    .then(function () {}, function () {});

  return res.status(200).json({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token
  });
};
