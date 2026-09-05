// Shared serverless helpers for the LFG bootcamp API.
// Uses the Supabase SERVICE key - server-side only, never shipped to the browser.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Which Postgres schema the app tables live in. The shared/old project isolates LFG in
// `lfg_dev`; the dedicated LFG DUBAI project uses the standard `public`. Driven by env so
// we can point preview at the new project while production stays on the old one until cutover.
const DB_SCHEMA = process.env.SUPABASE_SCHEMA || 'lfg_dev';

// Admin client scoped to the app schema (bypasses RLS via service role).
function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// Public read-only client - anon key, RLS enforced. Use for /api/packages
// and any catalogue endpoint that shouldn't run with service-role power.
function publicDb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// Plain service client for the Auth admin API (not schema-scoped).
function authService() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
}

// Leaderboard points. Each run check-in / bootcamp attended earns points automatically;
// manual admin awards (point_awards) add on top.
//
// RATE CHANGE (2026-06-17): runs went 10 -> 50, bootcamps 20 -> 100. Points are computed
// live from attendance, so to avoid retroactively revaluing past check-ins the rate is
// applied by DATE: anything dated on/after POINTS_RATE_CUTOVER earns the new rate, anything
// before keeps the old rate. The same cutover + rates are mirrored in the SQL function
// lfg_leaderboard - keep them in sync.
const POINTS_PER_RUN = 50;            // current rate (on/after cutover)
const POINTS_PER_BOOTCAMP = 100;      // current rate (on/after cutover)
const POINTS_PER_RUN_OLD = 10;        // locked historical rate (before cutover)
const POINTS_PER_BOOTCAMP_OLD = 20;   // locked historical rate (before cutover)
const POINTS_RATE_CUTOVER = '2026-06-17'; // Dubai calendar date; check-ins from this day on earn the new rate

// run_date / session_date are Dubai calendar date strings (YYYY-MM-DD), so a string compare
// against the cutover is correct. Missing dates fall back to the old (cheaper) rate.
function runPointsFor(dateStr) { return (dateStr && dateStr >= POINTS_RATE_CUTOVER) ? POINTS_PER_RUN : POINTS_PER_RUN_OLD; }
function bootcampPointsFor(dateStr) { return (dateStr && dateStr >= POINTS_RATE_CUTOVER) ? POINTS_PER_BOOTCAMP : POINTS_PER_BOOTCAMP_OLD; }

// Points per member across everyone: { member_id: { runs, bootcamps, bonus, points } }.
async function pointsByMember(db) {
  const [raR, paR, bkR, sessR] = await Promise.all([
    db.from('run_attendance').select('member_id,run_date').limit(100000),
    db.from('point_awards').select('member_id,points').limit(100000),
    db.from('bookings').select('member_id,session_id,status').eq('status', 'attended').limit(100000),
    db.from('sessions').select('id,session_date').limit(100000)
  ]);
  const sessDate = {}; (sessR.data || []).forEach(s => { sessDate[s.id] = s.session_date; });
  const runs = {}, runPts = {}, bonus = {}, bcs = {}, bcPts = {};
  (raR.data || []).forEach(r => {
    if (!r.member_id) return;
    runs[r.member_id] = (runs[r.member_id] || 0) + 1;
    runPts[r.member_id] = (runPts[r.member_id] || 0) + runPointsFor(r.run_date);
  });
  (bkR.data || []).forEach(b => {
    if (!b.member_id) return;
    bcs[b.member_id] = (bcs[b.member_id] || 0) + 1;
    bcPts[b.member_id] = (bcPts[b.member_id] || 0) + bootcampPointsFor(sessDate[b.session_id]);
  });
  (paR.data || []).forEach(p => { if (p.member_id) bonus[p.member_id] = (bonus[p.member_id] || 0) + Number(p.points || 0); });
  const out = {};
  new Set([...Object.keys(runs), ...Object.keys(bcs), ...Object.keys(bonus)]).forEach(id => {
    const rp = runPts[id] || 0, bp = bcPts[id] || 0, b = bonus[id] || 0;
    out[id] = { runs: runs[id] || 0, bootcamps: bcs[id] || 0, bonus: b, points: rp + bp + b };
  });
  return out;
}

// Points for a single member - used by /api/me. Date-split so old check-ins keep their rate.
async function memberPoints(db, memberId) {
  const [raR, paR, bkR, sessR] = await Promise.all([
    db.from('run_attendance').select('run_date').eq('member_id', memberId).limit(100000),
    db.from('point_awards').select('points').eq('member_id', memberId).limit(100000),
    db.from('bookings').select('session_id').eq('member_id', memberId).eq('status', 'attended').limit(100000),
    db.from('sessions').select('id,session_date').limit(100000)
  ]);
  const sessDate = {}; (sessR.data || []).forEach(s => { sessDate[s.id] = s.session_date; });
  let runs = 0, runPoints = 0;
  (raR.data || []).forEach(r => { runs += 1; runPoints += runPointsFor(r.run_date); });
  let bootcamps = 0, bootcampPoints = 0;
  (bkR.data || []).forEach(b => { bootcamps += 1; bootcampPoints += bootcampPointsFor(sessDate[b.session_id]); });
  const bonus = (paR.data || []).reduce((a, p) => a + Number(p.points || 0), 0);
  return { runs, bootcamps, bonus, runPoints, bootcampPoints, points: runPoints + bootcampPoints + bonus };
}

// Standard catch-block helper. Logs the real error server-side, returns a
// safe message to the client so Stripe/Supabase internals never leak.
function safeError(res, tag, err, fallback) {
  console.error('[' + tag + ']', err);
  return res.status(500).json({ error: fallback || 'Server error' });
}

// Verify the caller's Supabase JWT (from "Authorization: Bearer <token>") and return the user.
async function getUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const { data, error } = await authService().auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

async function getAuthUserById(id) {
  const { data } = await authService().auth.admin.getUserById(id);
  return data && data.user ? data.user : null;
}

// Guarantee a member row exists before any FK-dependent write (payments, packages, bookings).
// Throws on failure so callers can surface a real error.
async function ensureMember(db, user) {
  // Only write columns we actually have, so we never overwrite an existing name/email with null.
  const row = { id: user.id };
  if (user.email) row.email = user.email;
  const name = user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name);
  if (name) row.full_name = name;
  const { error } = await db.from('members').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('ensureMember: ' + error.message);
  // Generate a personal referral code on first encounter. Idempotent - RPC
  // early-returns if the member already has one. Failures are non-fatal (the
  // member can still book; we'll retry next /api/me call).
  try { await db.rpc('ensure_referral_code', { p_member_id: user.id }); }
  catch (e) { console.warn('[ensureMember] ensure_referral_code:', e.message); }
  return user.id;
}

// Create a guest player: a friend a member paid in, or a walk-in an admin typed
// onto the board. Every padel foreign key points at members, and members.id
// points at auth.users, so a player who never signed up still needs both rows.
//
// This is NOT the guest checkout that was closed on 2026-08-09, and it must not
// become one. That decision killed a PUBLIC path where a typed-in email minted
// an auth account, which is what produced ~220 junk GoTrue signups. Here the
// caller is either an admin or a member who has already paid for their own spot
// on this night, the write is service-role, and no email is ever sent: the
// account is created confirmed so GoTrue stays silent, with no password.
//
// If a real email is given the guest can later claim the account with a login
// link and inherit their level and points. With no email we synthesise an
// unroutable address so nothing can ever be delivered to it.
async function createGuestMember(db, { name, email, guestOf }) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!clean) throw new Error('createGuestMember: name required');

  const svc = authService();
  const realEmail = String(email || '').trim().toLowerCase() || null;
  // .invalid is reserved by RFC 2606 and can never resolve, so a guest with no
  // email cannot be mailed by us or by anything downstream reading the row.
  const loginEmail = realEmail || `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@padel.lfg.invalid`;

  let userId = null;
  const { data: created, error: cErr } = await svc.auth.admin.createUser({
    email: loginEmail,
    email_confirm: true,           // marks confirmed WITHOUT sending anything
    user_metadata: { full_name: clean, lfg_guest: true }
  });
  if (created && created.user) {
    userId = created.user.id;
  } else if (cErr && /already been registered|already exists/i.test(cErr.message || '')) {
    // The friend is already on LFG. Reuse their account rather than blocking the
    // purchase or creating a second one, and return existing:true so the caller
    // does NOT overwrite the level they set for themselves.
    // limit(1) not maybeSingle: members.email carries no unique constraint, and
    // a duplicate would turn a solvable case into a 500.
    const { data: existing } = await db.from('members').select('id').eq('email', realEmail).limit(1);
    if (!existing || !existing.length) throw new Error('createGuestMember: email taken but no member row');
    return { memberId: existing[0].id, existing: true };
  } else {
    throw new Error('createGuestMember: ' + ((cErr && cErr.message) || 'could not create the player'));
  }

  const { error: mErr } = await db.from('members').upsert(
    { id: userId, email: realEmail, full_name: clean, is_guest: true, guest_of: guestOf || null },
    { onConflict: 'id' }
  );
  if (mErr) throw new Error('createGuestMember: ' + mErr.message);
  return { memberId: userId, existing: false };
}

// True if the user is flagged as an admin/owner.
async function isAdmin(db, userId) {
  const { data } = await db.from('members').select('is_admin').eq('id', userId).maybeSingle();
  return !!(data && data.is_admin);
}

// True if the user is allowed to work the door: a gate volunteer, or an admin
// (an admin is always allowed everywhere staff are, so nobody has to hold both
// flags). Used by /api/staff/* so a door volunteer can read the live check-in
// board without any admin access. Fails closed: if the column or the row is
// missing the read errors out and this returns false.
async function isGateStaff(db, userId) {
  const { data } = await db.from('members').select('is_admin, is_gate_staff').eq('id', userId).maybeSingle();
  return !!(data && (data.is_admin || data.is_gate_staff));
}

// ---- gate link access ----
// The /gate board is a capability URL (owner's decision, 2026-08-31): possession
// of the secret link IS the authorization. /api/staff/* accepts EITHER a valid
// admin/gate-staff JWT (the pre-existing path, kept so admin usage still works)
// OR the shared token in the X-Gate-Key header, compared constant-time against
// event_config.gate_token. Rotation = one UPDATE on that row, no redeploy.
//
// Brute-force damper: a small in-memory per-IP counter. Per-instance and reset
// on cold start - not a real rate limiter, just enough to make guessing a
// 256-bit token even more pointless. Never log the token.
const GATE_FAIL_LIMIT = 20;
const gateFailBucket = new Map(); // ip -> { n, windowStart }

function gateRateLimited(ip) {
  const now = Date.now();
  const b = gateFailBucket.get(ip);
  if (!b || now - b.windowStart > 60000) { gateFailBucket.set(ip, { n: 0, windowStart: now }); return false; }
  return b.n >= GATE_FAIL_LIMIT;
}
function gateNoteFail(ip) {
  const b = gateFailBucket.get(ip);
  if (b) b.n += 1;
  if (gateFailBucket.size > 5000) gateFailBucket.clear(); // cap memory, worst case resets counters
}

// Gate for /api/staff/*: returns { db, user } on success (user is null on the
// token path) or writes the 401/403/429 and returns null.
async function requireGateAccess(req, res) {
  // Path 1: JWT - an admin, or a signed-in gate volunteer.
  const user = await getUser(req);
  if (user) {
    const db = admin();
    if (await isGateStaff(db, user.id)) return { db, user };
    res.status(403).json({ error: 'Gate staff only' });
    return null;
  }

  // Path 2: the shared gate-link token.
  const supplied = String(req.headers['x-gate-key'] || '');
  if (!supplied) { res.status(401).json({ error: 'Not authenticated' }); return null; }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (gateRateLimited(ip)) { res.status(429).json({ error: 'Too many attempts. Wait a minute.' }); return null; }

  const db = admin();
  const { data: cfg } = await db.from('event_config').select('gate_token').eq('id', 1).maybeSingle();
  const stored = cfg && cfg.gate_token ? String(cfg.gate_token) : '';

  let ok = false;
  if (stored) {
    const a = Buffer.from(supplied), b = Buffer.from(stored);
    if (a.length === b.length) ok = crypto.timingSafeEqual(a, b);
  }
  if (!ok) {
    gateNoteFail(ip);
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return { db, user: null };
}

// Whether this admin is allowed to see revenue/money figures. Defaults to TRUE so the
// owner and any existing/future admin keep full access; only accounts explicitly set to
// false (staff) are restricted. Used to strip revenue from the API responses server-side
// so a restricted admin can't read it from the network tab, not just hide it in the UI.
async function canViewRevenue(db, userId) {
  const { data } = await db.from('members').select('can_view_revenue').eq('id', userId).maybeSingle();
  return data ? data.can_view_revenue !== false : true;
}

// Single-call admin gate: verifies JWT + admin flag, returns the resolved
// { db, user } pair on success or writes the appropriate 401/403 + returns null.
// Endpoint pattern:
//   const gate = await requireAdmin(req, res);  if (!gate) return;
//   const { db, user } = gate;
async function requireAdmin(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const db = admin();
  if (!(await isAdmin(db, user.id))) { res.status(403).json({ error: 'Admins only' }); return null; }
  return { db, user };
}

// Admin-or-cron gate: same as requireAdmin but also accepts the
// LFG_CRON_TOKEN bearer for scheduler callers (GitHub Actions / Vercel Cron).
// Returns { db, mode: 'admin'|'cron', user? } on success.
async function requireAdminOrCron(req, res) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  if (process.env.LFG_CRON_TOKEN && token === process.env.LFG_CRON_TOKEN) {
    return { db: admin(), mode: 'cron' };
  }
  const { data } = await authService().auth.getUser(token);
  const user = data && data.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const db = admin();
  if (!(await isAdmin(db, user.id))) { res.status(403).json({ error: 'Admins only' }); return null; }
  return { db, mode: 'admin', user };
}

// Build the member-facing account payload (credits, attendance, upcoming bookings).
async function buildMeResponse(db, user) {
  // ensureMember has to run first because every later query depends on the row
  // existing + a referral_code being assigned. Everything after can fan out in
  // parallel to keep /api/me snappy from cold start.
  await ensureMember(db, user);

  const now = new Date();
  const emailLock = user.email ? user.email.toLowerCase() : null;

  const [
    meRowRes,
    pkgsRes,
    attendedRes,
    bookingsRes,
    streakRes,
    rewardsRes,
    pointsRes,
    merchRes
  ] = await Promise.all([
    db.from('members').select('full_name,referral_code').eq('id', user.id).maybeSingle(),
    db.from('member_packages').select('sessions_remaining,expires_at,status').eq('member_id', user.id),
    db.from('bookings').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('status', 'attended'),
    db.from('bookings')
      .select('id,status,booked_at,section,session:sessions(session_date,start_time,location)')
      .eq('member_id', user.id)
      .in('status', ['booked', 'attended'])
      .order('booked_at', { ascending: false }),
    db.rpc('member_streak_stats', { p_member_id: user.id }).then(r => r, e => ({ data: null, error: e })),
    emailLock
      ? db.from('promo_codes')
          .select('code,value,kind,expires_at,times_redeemed,max_redemptions')
          .eq('email_lock', emailLock).eq('active', true)
      : Promise.resolve({ data: [] }),
    memberPoints(db, user.id),
    db.from('merch_orders').select('product,size,amount_aed,status,created_at').eq('member_id', user.id).order('created_at', { ascending: false })
  ]);

  const meRow = meRowRes.data;
  const pkgs = pkgsRes.data || [];
  const attended = attendedRes.count || 0;
  const bookings = bookingsRes.data || [];
  const rewards = rewardsRes.data || [];
  const merchOrders = (merchRes.data || []).map(o => ({
    size: o.size,
    amount_aed: Number(o.amount_aed || 0),
    status: o.status,                 // paid | fulfilled | cancelled
    fulfilled: o.status === 'fulfilled',
    created_at: o.created_at
  }));

  let sessionsRemaining = 0;
  pkgs.forEach(p => {
    if (p.status === 'active' && p.sessions_remaining > 0 && new Date(p.expires_at) > now) {
      sessionsRemaining += p.sessions_remaining;
    }
  });

  const today = new Date(now.toDateString());
  const upcoming = bookings
    .filter(b => b.session && new Date(b.session.session_date) >= today)
    .map(b => ({
      id: b.id,
      date_label: formatDate(b.session.session_date, b.session.start_time),
      location: b.session.location,
      section: b.section,
      status: b.status === 'attended' ? 'Attended' : 'Booked',
      can_cancel: b.status === 'booked' && cancelCutoffOk(b.session.session_date)
    }));

  let streak = null;
  const s = streakRes.data;
  if (s) streak = {
    current: Number(s.current || 0),
    best: Number(s.best || 0),
    total: Number(s.total || 0),
    member_since: s.member_since || null,
    attended_this_month: Number(s.attended_this_month || 0),
    rank_this_month: s.rank_this_month == null ? null : Number(s.rank_this_month)
  };
  if (streakRes.error) console.warn('[buildMeResponse] streak stats:', streakRes.error.message);

  const referralCode = meRow ? meRow.referral_code : null;

  // The referral-used count needs the code we just read, so it can't go in the
  // big Promise.all above. One small extra round-trip.
  let referralUsedCount = 0;
  if (referralCode) {
    const { data: ownCode } = await db.from('promo_codes')
      .select('times_redeemed').eq('code', referralCode).maybeSingle();
    if (ownCode) referralUsedCount = ownCode.times_redeemed || 0;
  }

  const activeRewards = rewards
    .filter(r => r.times_redeemed === 0 && (!r.expires_at || new Date(r.expires_at) > now))
    .map(r => ({
      code: r.code,
      label: r.kind === 'percent' ? r.value + '% off' : 'AED ' + r.value + ' off',
      expires_at: r.expires_at
    }));

  return {
    email: user.email,
    full_name: meRow ? meRow.full_name : null,
    needs_name: !(meRow && meRow.full_name),
    sessions_remaining: sessionsRemaining,
    sessions_attended: attended,
    upcoming_bookings: upcoming,
    referral_code: referralCode,
    referral_used_count: referralUsedCount,
    active_rewards: activeRewards,
    streak: streak,
    points: pointsRes ? pointsRes.points : 0,
    points_runs: pointsRes ? pointsRes.runs : 0,
    points_bootcamps: pointsRes ? pointsRes.bootcamps : 0,
    points_bonus: pointsRes ? pointsRes.bonus : 0,
    points_runs_value: pointsRes ? pointsRes.runPoints : 0,
    points_bootcamps_value: pointsRes ? pointsRes.bootcampPoints : 0,
    points_per_run: POINTS_PER_RUN,
    points_per_bootcamp: POINTS_PER_BOOTCAMP,
    merch_orders: merchOrders
  };
}

function formatDate(d, t) {
  const time = (t || '08:30').slice(0, 5);
  const date = new Date(d + 'T' + time + ':00');
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + time;
}

// True when the current moment is still before 08:00 Asia/Dubai on the given session date.
function cancelCutoffOk(sessionDateStr) {
  const cutoffMs = Date.parse(sessionDateStr + 'T08:00:00+04:00');
  return Date.now() < cutoffMs;
}

// Look up a promo code and (if it's redeemable) compute the discount preview.
// Pure read-only - never mutates times_redeemed. Used by both the validate endpoint
// (so members see a preview) and checkout (final price). Atomic redemption is done
// by the redeem_promo RPC inside the Stripe webhook on confirmed payment.
//
// Returns one of:
//   { ok: false, error: '...' }   when the code is missing/expired/over-used/inactive
//   { ok: true, code, kind, value, original_amount, discount_amount, final_amount, label }
async function validatePromoCode(db, rawCode, originalAmountAed, userEmail) {
  if (!rawCode || typeof rawCode !== 'string') return { ok: false, error: 'Enter a code' };
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) return { ok: false, error: 'Invalid code format' };

  const { data: promo, error } = await db.from('promo_codes')
    .select('code,kind,value,active,expires_at,max_redemptions,times_redeemed,email_lock,referral_owner_id')
    .eq('code', code)
    .maybeSingle();
  if (error) return { ok: false, error: 'Could not validate' };
  if (!promo) return { ok: false, error: 'Invalid promo code' };
  if (!promo.active) return { ok: false, error: 'Code is no longer active' };
  if (promo.expires_at && new Date(promo.expires_at) <= new Date()) return { ok: false, error: 'Code has expired' };
  if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) {
    return { ok: false, error: 'Code is fully redeemed' };
  }
  // email_lock: when set the code is reserved for one specific email (case-insensitive).
  if (promo.email_lock) {
    const expected = String(promo.email_lock).trim().toLowerCase();
    const actual = String(userEmail || '').trim().toLowerCase();
    if (!actual || actual !== expected) return { ok: false, error: 'This code is reserved for another account' };
  }
  // Referral guard: a member can't use their own referral code. Look up the
  // owner's email and reject if it matches the buyer.
  if (promo.referral_owner_id) {
    const buyerEmail = String(userEmail || '').toLowerCase();
    const { data: owner } = await db.from('members').select('email').eq('id', promo.referral_owner_id).maybeSingle();
    const ownerEmail = (owner && owner.email || '').toLowerCase();
    if (ownerEmail && buyerEmail && ownerEmail === buyerEmail) {
      return { ok: false, error: "You can't use your own referral code." };
    }
    // First-bootcamp-only: a referral code is a one-time welcome for a genuinely new
    // member. Once this account/email has booked or holds any bootcamp credit, no
    // referral code (yours or anyone else's) can be used again.
    if (buyerEmail) {
      const { data: buyer } = await db.from('members').select('id').eq('email', buyerEmail).maybeSingle();
      if (buyer && buyer.id) {
        const [bkR, mpR] = await Promise.all([
          db.from('bookings').select('id', { count: 'exact', head: true }).eq('member_id', buyer.id).in('status', ['booked', 'attended']),
          db.from('member_packages').select('id', { count: 'exact', head: true }).eq('member_id', buyer.id)
        ]);
        if ((bkR.count || 0) > 0 || (mpR.count || 0) > 0) {
          return { ok: false, error: 'Referral codes are only valid on your first LFG bootcamp.' };
        }
      }
    }
  }

  const amount = Number(originalAmountAed) || 0;
  let final;
  let label;
  if (promo.kind === 'percent') {
    final = amount * (1 - Number(promo.value) / 100);
    label = Number(promo.value) + '% off';
  } else {
    final = Math.max(0, amount - Number(promo.value));
    label = 'AED ' + Number(promo.value) + ' off';
  }
  final = Math.round(final * 100) / 100;
  const discount = Math.round((amount - final) * 100) / 100;

  return {
    ok: true,
    code: promo.code,
    kind: promo.kind,
    value: Number(promo.value),
    original_amount: amount,
    discount_amount: discount,
    final_amount: final,
    label,
    is_referral: !!promo.referral_owner_id
  };
}

function sectionCapN(total, idx, n) { return Math.floor(total / n) + (idx < (total % n) ? 1 : 0); }
function stationLabelsN(n) { const o = []; for (let i = 0; i < (n || 4); i++) o.push(String.fromCharCode(65 + i)); return o; }

// PostgREST answers with at most 1000 rows and says nothing about the rest, so a
// growing table quietly starts returning a partial answer. That is how the run
// roster emptied itself in Aug 2026. Use this wherever a query has no natural
// ceiling: it pages until the last page comes back short. On error it returns the
// rows gathered so far, because every caller here already treats a failed read as
// "no data" rather than crashing the dashboard. Give the query a stable .order():
// paging an unordered result can repeat or skip rows between pages.
async function fetchAllRows(makeQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: out, error };
    const rows = data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
  }
  return { data: out, error: null };
}

// Owner dashboard rollup: totals, per-member rows, upcoming session fill. Shared by stats + CSV export.
async function ownerStats(db) {
  const now = new Date();
  const [membersR, pkgR, bookR, payR, sessR, pointsMap] = await Promise.all([
    db.from('members').select('id,email,full_name,created_at,is_admin'),
    db.from('member_packages').select('member_id,sessions_total,sessions_remaining,status,expires_at'),
    db.from('bookings').select('member_id,session_id,section,status,booked_at'),
    // Lifetime spend per member, so this one genuinely needs every paid row: it was
    // at 911 of the 1000-row ceiling in Sep 2026 and would have started understating
    // revenue without a word. Paged rather than date-capped.
    // The id sort is load-bearing: paging an unordered query can repeat or skip
    // rows between pages. Order is irrelevant to the sums below.
    fetchAllRows(() => db.from('payments').select('member_id,amount_aed,status,created_at')
      .eq('status', 'paid').order('id', { ascending: true })),
    db.from('sessions').select('id,session_date,start_time,location,capacity,status,stations,photo_url')
      .gte('session_date', new Date(now.toDateString()).toISOString().slice(0, 10)).order('session_date'),
    pointsByMember(db)
  ]);
  const members = membersR.data || [], pkgs = pkgR.data || [], bookings = bookR.data || [], payments = payR.data || [], sessions = sessR.data || [];

  const spendBy = {}, creditsBy = {}, attendedBy = {}, bookedBy = {}, lastBy = {};
  payments.forEach(p => { if (p.member_id) spendBy[p.member_id] = (spendBy[p.member_id] || 0) + Number(p.amount_aed || 0); });
  pkgs.forEach(p => {
    if (p.status === 'active' && p.sessions_remaining > 0 && new Date(p.expires_at) > now) {
      creditsBy[p.member_id] = (creditsBy[p.member_id] || 0) + p.sessions_remaining;
    }
  });
  bookings.forEach(b => {
    if (b.status === 'cancelled') return;
    bookedBy[b.member_id] = (bookedBy[b.member_id] || 0) + 1;
    if (b.status === 'attended') attendedBy[b.member_id] = (attendedBy[b.member_id] || 0) + 1;
    const t = new Date(b.booked_at).getTime();
    if (!lastBy[b.member_id] || t > lastBy[b.member_id]) lastBy[b.member_id] = t;
  });

  const THIRTY = 30 * 24 * 3600 * 1000;
  // Show everyone in the members table, admins included - an admin can also be a club
  // member (Loay) and needs to see/adjust their own credits + points. Business-metric
  // totals below still exclude admins so staff don't inflate the member counts.
  const memberRows = members.map(m => {
    const last = lastBy[m.id] || new Date(m.created_at).getTime();
    return {
      email: m.email, name: m.full_name || '', is_admin: !!m.is_admin,
      joined: m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '',
      spend: Math.round((spendBy[m.id] || 0) * 100) / 100,
      credits: creditsBy[m.id] || 0,
      booked: bookedBy[m.id] || 0,
      attended: attendedBy[m.id] || 0,
      points: (pointsMap[m.id] && pointsMap[m.id].points) || 0,
      points_runs: (pointsMap[m.id] && pointsMap[m.id].runs) || 0,
      points_bootcamps: (pointsMap[m.id] && pointsMap[m.id].bootcamps) || 0,
      points_bonus: (pointsMap[m.id] && pointsMap[m.id].bonus) || 0,
      last_activity: new Date(last).toISOString().slice(0, 10),
      lapsed: (now.getTime() - last) > THIRTY
    };
  });

  const totals = {
    members: members.filter(m => !m.is_admin).length,
    package_holders: Object.keys(creditsBy).length,
    credits_outstanding: Object.values(creditsBy).reduce((a, b) => a + b, 0),
    credits_purchased: pkgs.reduce((a, p) => a + (p.sessions_total || 0), 0),
    credits_used: pkgs.reduce((a, p) => a + ((p.sessions_total || 0) - (p.sessions_remaining || 0)), 0),
    bookings: bookings.filter(b => b.status !== 'cancelled').length,
    attended: bookings.filter(b => b.status === 'attended').length,
    revenue: Math.round(payments.reduce((a, p) => a + Number(p.amount_aed || 0), 0) * 100) / 100,
    lapsed: memberRows.filter(m => m.lapsed && !m.is_admin).length
  };

  // Extra value metrics
  const cutoff = now.getTime() - 30 * 24 * 3600 * 1000;
  totals.new_members_30d = members.filter(m => !m.is_admin && m.created_at && new Date(m.created_at).getTime() >= cutoff).length;
  totals.revenue_30d = Math.round(payments.filter(p => p.created_at && new Date(p.created_at).getTime() >= cutoff).reduce((a, p) => a + Number(p.amount_aed || 0), 0) * 100) / 100;
  totals.attendance_rate = totals.bookings ? Math.round(totals.attended / totals.bookings * 100) : 0;

  const bySession = {};
  bookings.filter(b => b.status !== 'cancelled').forEach(b => {
    const e = bySession[b.session_id] || (bySession[b.session_id] = { total: 0, secs: {} });
    e.total++; if (b.section) e.secs[b.section] = (e.secs[b.section] || 0) + 1;
  });
  const sessionRows = sessions.map(s => {
    const e = bySession[s.id] || { total: 0, secs: {} };
    const n = s.stations || 4;
    return {
      id: s.id, date_label: formatDate(s.session_date, s.start_time), capacity: s.capacity, booked: e.total,
      stations: n, photo_url: s.photo_url || null,
      sections: stationLabelsN(n).map((l, i) => ({ label: l, booked: e.secs[l] || 0, cap: sectionCapN(s.capacity, i, n) }))
    };
  });

  // Recently-held camps (last 2) stay visible so coaches can still upload the photo and import
  // points after the day ends - the upcoming-only cutoff was hiding them too aggressively.
  const todayYMD = new Date(now.toDateString()).toISOString().slice(0, 10);
  const { data: pastSessRows } = await db.from('sessions')
    .select('id,session_date,start_time,location,capacity,status,stations,photo_url')
    .lt('session_date', todayYMD).order('session_date', { ascending: false }).limit(2);
  const recentSessionRows = (pastSessRows || []).map(s => {
    const e = bySession[s.id] || { total: 0, secs: {} };
    const n = s.stations || 4;
    return {
      id: s.id, date_label: formatDate(s.session_date, s.start_time), capacity: s.capacity, booked: e.total,
      stations: n, photo_url: s.photo_url || null, past: true,
      sections: stationLabelsN(n).map((l, i) => ({ label: l, booked: e.secs[l] || 0, cap: sectionCapN(s.capacity, i, n) }))
    };
  });

  // Daily trend series (last 14 days, Dubai calendar) for the dashboard charts.
  // Paid revenue only (payments already filtered to status='paid' above).
  function dubaiYMD(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  function dubaiLabel(d) { return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' }).format(d); }
  var days = [], dayIndex = {};
  for (var i = 13; i >= 0; i--) {
    var d = new Date(now.getTime() - i * 864e5);
    var key = dubaiYMD(d);
    dayIndex[key] = days.length;
    days.push({ key: key, label: dubaiLabel(d), revenue: 0, signups: 0 });
  }
  payments.forEach(p => { if (p.created_at) { var k = dubaiYMD(new Date(p.created_at)); if (k in dayIndex) days[dayIndex[k]].revenue += Number(p.amount_aed || 0); } });
  members.forEach(m => { if (!m.is_admin && m.created_at) { var k = dubaiYMD(new Date(m.created_at)); if (k in dayIndex) days[dayIndex[k]].signups++; } });

  // Latest paid orders for the revenue view: who paid, what, how much, when.
  const memById = {};
  members.forEach(m => { memById[m.id] = m; });
  const { data: latestPayRows } = await db.from('payments')
    .select('member_id,amount_aed,kind,promo_code,created_at')
    .eq('status', 'paid').order('created_at', { ascending: false }).limit(20);
  const latest_payments = (latestPayRows || []).map(p => {
    const m = memById[p.member_id] || {};
    return {
      name: m.full_name || (m.email ? m.email.split('@')[0] : '—'),
      email: m.email || null,
      kind: p.kind || 'single',
      amount_aed: Math.round(Number(p.amount_aed || 0) * 100) / 100,
      promo_code: p.promo_code || null,
      created_at: p.created_at
    };
  });

  return {
    totals,
    members: memberRows,
    sessions: sessionRows,
    recent_sessions: recentSessionRows,
    latest_payments,
    revenue_series: days.map(w => ({ label: w.label, value: Math.round(w.revenue) })),
    signups_series: days.map(w => ({ label: w.label, value: w.signups }))
  };
}

// Idempotent fulfilment for a Stripe Checkout Session. Used by both the webhook
// (normal path) and /api/admin/reconcile-payments (recovery path for stuck rows).
//
// Returns one of:
//   { ok: true, fulfilled: 'package'|'single' }       - work was done
//   { ok: true, dedup: true, reason: '...' }          - already done, no-op
//   { ok: false, error: '...' }                       - hard failure
//
// `sessionObj` is the full Checkout Session as returned by Stripe (or a
// faithful reconstruction from the webhook event).
async function fulfillCheckoutSession(db, sessionObj) {
  const md = sessionObj.metadata || {};
  if (!md.member_id || !md.kind) return { ok: true, dedup: true, reason: 'no LFG metadata' };

  // Member must exist before we can FK against it.
  const authUser = await getAuthUserById(md.member_id);
  await ensureMember(db, authUser || { id: md.member_id });

  const claim = await db.rpc('claim_fulfilment', {
    p_session_id: sessionObj.id,
    p_payment_intent: sessionObj.payment_intent,
    p_member_id: md.member_id,
    p_kind: md.kind,
    p_amount_aed: (sessionObj.amount_total || 0) / 100,
    p_promo_code: md.promo_code || null
  });
  if (claim.error) return { ok: false, error: 'claim_fulfilment: ' + claim.error.message };
  if (!claim.data || claim.data.ok !== true) {
    return { ok: true, dedup: true, reason: (claim.data && claim.data.reason) || 'already_claimed' };
  }

  // Capture name from Stripe checkout if we don't have one yet.
  const stripeName = sessionObj.customer_details && sessionObj.customer_details.name;
  if (stripeName) await db.from('members').update({ full_name: stripeName }).eq('id', md.member_id).is('full_name', null);

  // Capture details we may need for the confirmation email AFTER the booking/credit lands.
  let emailKind = null;
  let emailArgs = null;
  const paidAmount = (sessionObj.amount_total || 0) / 100;

  if (md.kind === 'package') {
    const { data: pkg, error: pkgErr } = await db.from('packages').select('*').eq('id', md.package_id).single();
    if (pkgErr || !pkg) return { ok: false, error: 'package lookup: ' + (pkgErr ? pkgErr.message : 'not found') };
    const expires = new Date();
    expires.setMonth(expires.getMonth() + (pkg.validity_months || 2));
    const { error: mpErr } = await db.from('member_packages').insert({
      member_id: md.member_id,
      package_id: pkg.id,
      sessions_total: pkg.sessions_count,
      sessions_remaining: pkg.sessions_count,
      expires_at: expires.toISOString(),
      status: 'active',
      stripe_payment_intent: sessionObj.payment_intent
    });
    if (mpErr) return { ok: false, error: 'credit package: ' + mpErr.message };
    emailKind = 'package';
    emailArgs = {
      kind: 'package',
      memberId: md.member_id,
      packageName: pkg.name,
      sessionsCount: pkg.sessions_count,
      paidAmount,
      expiresAtIso: expires.toISOString()
    };
  } else if (md.kind === 'single' && md.session_id) {
    const { data: booked, error: bErr } = await db.rpc('book_paid', {
      p_member: md.member_id,
      p_session: md.session_id,
      p_section: md.section || null,
      p_amount: paidAmount
    });
    if (bErr) return { ok: false, error: 'book_paid: ' + bErr.message };
    if (booked && !booked.ok && !booked.dedup) console.warn('[fulfill] single booking not placed:', booked.error);
    // A fresh payment that dedups means we captured the card but the member already
    // held this seat (the duplicate-charge case). The checkout guard should stop this
    // before charging; if we still land here, flag it loudly so it can be refunded.
    if (booked && booked.dedup) console.warn('[fulfill] DUPLICATE single payment - already booked, no new ticket. Refund candidate. member=' + md.member_id + ' session=' + md.session_id + ' pi=' + sessionObj.payment_intent);
    // Look up the session for the confirmation + .ics.
    const { data: sess } = await db.from('sessions').select('session_date,location').eq('id', md.session_id).maybeSingle();
    if (sess) {
      emailKind = 'single';
      emailArgs = {
        kind: 'single',
        memberId: md.member_id,
        sessionId: md.session_id,
        sessionDate: sess.session_date,
        section: md.section || null,
        location: sess.location || 'CrossFit Alioth',
        paidAmount
      };
    }
  } else if (md.kind === 'merch') {
    // Record the paid t-shirt order. Idempotent via the unique index on payment_intent
    // (claim_fulfilment above already guarantees we only reach here once per session).
    const { error: moErr } = await db.from('merch_orders').insert({
      member_id: md.member_id,
      product: md.product || 'lfg-tee-2025',
      size: md.size || null,
      amount_aed: paidAmount,
      status: 'paid',
      stripe_session_id: sessionObj.id,
      stripe_payment_intent: sessionObj.payment_intent
    });
    if (moErr && !/duplicate key|unique/i.test(moErr.message || '')) {
      return { ok: false, error: 'merch order: ' + moErr.message };
    }
    // Dedicated merch confirmation (best-effort). Not routed through sendBookingConfirmation,
    // which only knows package/single. emailKind stays null so that path is skipped.
    try {
      const { sendEmail, emailShell, escapeHtml } = require('./_email');
      const { data: m } = await db.from('members').select('email,full_name').eq('id', md.member_id).maybeSingle();
      if (m && m.email) {
        const first = escapeHtml((m.full_name || '').split(/\s+/)[0] || 'there');
        const body = `
          <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">You got the <span style="color:#999966;">tee.</span></h1>
          <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">Hey ${first}, your LFG Tee is locked in.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
            <tr><td style="padding:20px 22px;text-align:center;">
              <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">Your order</div>
              <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:24px;letter-spacing:0.02em;color:#fff;">LFG Tee · Size ${escapeHtml(md.size || '-')}</div>
              <div style="margin-top:8px;color:rgba(255,255,255,0.6);font-size:13px;">Pick it up at the next run. We'll have it ready with your name on it.</div>
            </td></tr>
          </table>
          <p style="margin:22px 0 0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">See you Wednesday. — LFG</p>
        `;
        await sendEmail({
          to: m.email,
          subject: 'Your LFG tee is locked in 🖤',
          html: emailShell({ preheader: 'LFG Tee · pick up at the next run.', bodyHtml: body })
        });
      }
    } catch (e) { console.warn('[fulfill] merch email skipped:', e && e.message); }
  } else if (md.kind === 'run') {
    // Paid run (e.g. Gems World Academy intervals). Mark the roster RSVP as paid so the
    // owner sees who's actually paid in. claim_fulfilment above already recorded the
    // payment; here we flip the run_rsvps row and send a run-specific confirmation.
    const runDate = md.run_date || null;
    if (runDate) {
      const { error: rErr } = await db.from('run_rsvps').upsert(
        { member_id: md.member_id, run_date: runDate, run_type: md.run_type || null,
          attending: true, paid: true, amount_aed: paidAmount,
          stripe_payment_intent: sessionObj.payment_intent, updated_at: new Date().toISOString() },
        { onConflict: 'member_id,run_date' }
      );
      if (rErr) console.warn('[fulfill] run rsvp mark-paid failed:', rErr.message);
    }
    // Dedicated run confirmation (best-effort). emailKind stays null so the package/single
    // confirmation path is skipped.
    try {
      const { sendEmail, emailShell, escapeHtml } = require('./_email');
      const { data: m } = await db.from('members').select('email,full_name').eq('id', md.member_id).maybeSingle();
      if (m && m.email) {
        const first = escapeHtml((m.full_name || '').split(/\s+/)[0] || 'there');
        const loc = escapeHtml(md.location || 'the next run');
        const body = `
          <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">You're <span style="color:#999966;">paid in.</span></h1>
          <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">Hey ${first}, your spot for the run is locked.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
            <tr><td style="padding:20px 22px;text-align:center;">
              <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">Your spot</div>
              <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:22px;letter-spacing:0.02em;color:#fff;">${loc}</div>
              <div style="margin-top:8px;color:rgba(255,255,255,0.6);font-size:13px;">Paid · AED ${escapeHtml(String(paidAmount))} · intervals session</div>
            </td></tr>
          </table>
          <p style="margin:22px 0 0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">Bring water and your best legs. See you there. — LFG</p>
        `;
        await sendEmail({
          to: m.email,
          subject: "You're paid in for the LFG run 🏃",
          html: emailShell({ preheader: 'Your spot for the LFG run is locked.', bodyHtml: body })
        });
      }
    } catch (e) { console.warn('[fulfill] run email skipped:', e && e.message); }

    // Paid runs are real money in - push the payer into GHL as a hot, paying lead (reuses the
    // existing 'Hot' stage + a 'paid runclub' tag). Fire-and-forget; honors GHL_DRY_RUN.
    try {
      const ghl = require('./_ghl');
      const { data: gm } = await db.from('members').select('email,full_name').eq('id', md.member_id).maybeSingle();
      if (gm && gm.email) {
        const { data: rg } = await db.from('run_registrations')
          .select('whatsapp_e164').eq('member_id', md.member_id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const [gf, ...gr] = (gm.full_name || '').split(' ');
        await ghl.onPaidRun({
          email: gm.email,
          firstName: gf || undefined,
          lastName: gr.length ? gr.join(' ') : undefined,
          whatsapp_e164: rg ? rg.whatsapp_e164 : undefined,
          amountAed: paidAmount
        });
      }
    } catch (e) { console.warn('[fulfill run → ghl]', e && e.message); }
  } else if (md.kind === 'padel') {
    // Paid padel night. claim_fulfilment above already recorded the payment;
    // flip the signup to paid so the roster + capacity count see it, then send
    // the padel confirmation. emailKind stays null (package/single path skipped).
    const eventDate = md.run_date || null;
    // padel_for is set when a member bought this spot for a friend: the money
    // and the email belong to the buyer (md.member_id), the SPOT belongs to the
    // guest. Absent it, buyer and player are the same person, as before.
    const playerId = md.padel_for || md.member_id;
    const guestName = md.guest_name || null;
    if (eventDate) {
      const { error: sErr } = await db.from('padel_signups').upsert(
        { member_id: playerId, event_date: eventDate, attending: true, paid: true,
          amount_aed: paidAmount, stripe_payment_intent: sessionObj.payment_intent,
          updated_at: new Date().toISOString() },
        { onConflict: 'member_id,event_date' }
      );
      if (sErr) console.warn('[fulfill] padel signup mark-paid failed:', sErr.message);
    }
    try {
      const { sendEmail, emailShell, escapeHtml } = require('./_email');
      const { data: m } = await db.from('members').select('email,full_name').eq('id', md.member_id).maybeSingle();
      if (m && m.email) {
        const first = escapeHtml((m.full_name || '').split(/\s+/)[0] || 'there');
        const loc = escapeHtml(md.location || 'the courts');
        let nightLine = 'Tuesday night';
        try {
          nightLine = new Date(eventDate + 'T12:00:00Z').toLocaleDateString('en-US',
            { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
        } catch (e) { /* keep fallback */ }
        const body = `
          <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">${guestName ? 'They&rsquo;re on' : 'You&rsquo;re on'} <span style="color:#999966;">court.</span></h1>
          <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">${guestName
            ? `Hey ${first}, ${escapeHtml(guestName)}&rsquo;s spot is locked. Bring them with you.`
            : `Hey ${first}, your spot for padel is locked.`}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
            <tr><td style="padding:20px 22px;text-align:center;">
              <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">Your night</div>
              <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:22px;letter-spacing:0.02em;color:#fff;">${escapeHtml(nightLine)} · ${loc}</div>
              <div style="margin-top:8px;color:rgba(255,255,255,0.6);font-size:13px;">Paid · AED ${escapeHtml(String(paidAmount))} · ${guestName ? 'they' : 'you'}&rsquo;ll be matched to ${guestName ? 'their' : 'your'} level on the night</div>
            </td></tr>
          </table>
          <p style="margin:22px 0 0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">Arrive 15 minutes early. Rackets sorted if you need one. — LFG</p>
        `;
        await sendEmail({
          to: m.email,
          subject: "You're on court · LFG Padel 🎾",
          html: emailShell({ preheader: 'Your padel night is locked. Courts drop before the night.', bodyHtml: body })
        });
      }
    } catch (e) { console.warn('[fulfill] padel email skipped:', e && e.message); }
  }

  if (md.promo_code) {
    const { data: redeemed, error: rErr } = await db.rpc('redeem_promo', {
      p_code: md.promo_code,
      p_member_id: md.member_id,
      p_payment_intent: sessionObj.payment_intent
    });
    if (rErr) console.warn('[fulfill] redeem_promo error:', rErr.message);
    else if (redeemed && !redeemed.ok) console.warn('[fulfill] redeem_promo soft-fail:', redeemed.error, 'code:', md.promo_code);

    // Referral reward: if this was someone's referral code, the owner of the code
    // earns a personal 1-time 15% off code, locked to their email, 60-day expiry.
    try {
      const { data: promo } = await db.from('promo_codes')
        .select('referral_owner_id')
        .eq('code', md.promo_code)
        .maybeSingle();
      if (promo && promo.referral_owner_id) {
        const { data: owner } = await db.from('members')
          .select('id,email,full_name,referral_code')
          .eq('id', promo.referral_owner_id).maybeSingle();
        if (owner && owner.email) {
          const crypto = require('crypto');
          const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
          const bytes = crypto.randomBytes(6);
          let suffix = '';
          for (let i = 0; i < bytes.length; i++) suffix += alphabet[bytes[i] % alphabet.length];
          const rewardCode = 'RWD-' + suffix;
          const expiresAt = new Date(Date.now() + 60 * 86400 * 1000).toISOString();
          const { error: insErr } = await db.from('promo_codes').insert({
            code: rewardCode,
            kind: 'percent',
            value: 15,
            active: true,
            max_redemptions: 1,
            expires_at: expiresAt,
            email_lock: owner.email
          });
          if (insErr) console.warn('[fulfill] referral-reward insert:', insErr.message);
          else {
            // Best-effort email to the owner letting them know their reward landed.
            try {
              const { sendEmail, emailShell, escapeHtml } = require('./_email');
              const friendName = (md.member_id && md.member_id !== owner.id) ? null : null;
              const body = `
                <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">Your referral <span style="color:#999966;">paid off.</span></h1>
                <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">Hey ${escapeHtml((owner.full_name || '').split(/\s+/)[0] || 'there')},<br>Someone you sent over just booked. Here's your 15% off for the next one.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
                  <tr><td style="padding:20px 22px;text-align:center;">
                    <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">Your reward code</div>
                    <div style="font-family:'Courier New',monospace;font-weight:700;font-size:28px;letter-spacing:0.04em;color:#fff;">${escapeHtml(rewardCode)}</div>
                    <div style="margin-top:8px;color:rgba(255,255,255,0.6);font-size:13px;">15% off · expires in 60 days · one use</div>
                  </td></tr>
                </table>
                <p style="margin:22px 0 0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">Type it at checkout when you book your next Sunday. It only works for your account.</p>
              `;
              await sendEmail({
                to: owner.email,
                subject: 'Your referral paid off · 15% off on us',
                html: emailShell({ preheader: 'You earned a 15% off code from a friend\'s booking.', bodyHtml: body })
              });
            } catch (e) { console.warn('[fulfill] referral reward email skipped:', e.message); }
          }
        }
      }
    } catch (e) {
      console.warn('[fulfill] referral reward path threw:', e.message);
    }
  }

  // Dispatch the branded confirmation. Lazy-require keeps the email module out of
  // the import graph for code paths that don't need it (and avoids a circular dep).
  if (emailKind) {
    try {
      const { sendBookingConfirmation } = require('./_email');
      const r = await sendBookingConfirmation(db, emailArgs);
      if (!r.ok) console.warn('[fulfill] confirmation email skipped:', r.error);
    } catch (e) {
      console.warn('[fulfill] confirmation email threw:', e.message);
    }
  }

  // Push to GHL after credit/booking has landed. Fire-and-forget - helper has
  // its own try/catch and won't throw. Honors GHL_DRY_RUN + GHL_DISABLED.
  // Merch buyers + paid-run entries aren't bootcamp purchasers - skip the bootcamp tag.
  // (Run registrants already synced to GHL via run-register's onRunRegister.)
  if (md.kind !== 'merch' && md.kind !== 'run') {
    try {
      const ghl = require('./_ghl');
      const { data: m } = await db.from('members').select('email,full_name').eq('id', md.member_id).maybeSingle();
      if (m && m.email) {
        const [firstName, ...rest] = (m.full_name || '').split(' ');
        await ghl.onBootcampPurchase({
          email: m.email,
          firstName: firstName || undefined,
          lastName: rest.length ? rest.join(' ') : undefined,
          amountAed: paidAmount
        });
      }
    } catch (e) { console.warn('[fulfill → ghl]', e && e.message); }
  }

  return { ok: true, fulfilled: md.kind };
}

// Canonical site origin for the current request. Forces the apex domain to www so
// auth redirects never pass through the apex→www 308 (which drops the #access_token
// fragment in in-app browsers). Preview/localhost hosts pass through unchanged.
function canonicalOrigin(req) {
  let host = (req && req.headers && req.headers.host) || 'www.lfgdubai.com';
  if (host === 'lfgdubai.com') host = 'www.lfgdubai.com';
  const proto = (req && req.headers && req.headers['x-forwarded-proto']) || 'https';
  return proto + '://' + host;
}

// Build a sign-in URL that points at our own /auth page carrying the one-time
// token_hash in the QUERY string. Query params survive redirects (unlike the
// implicit #access_token hash, which in-app browsers strip), and the /auth page
// verifies it client-side with verifyOtp. Falls back to Supabase's action_link.
function buildAuthLink(origin, link, nextPath) {
  const p = link && link.properties;
  if (!p) return null;
  if (p.hashed_token) {
    return origin + '/auth?token_hash=' + encodeURIComponent(p.hashed_token) +
      '&type=email&next=' + encodeURIComponent(nextPath || '/account');
  }
  return p.action_link || null;
}

module.exports = {
  admin, publicDb, authService,
  canonicalOrigin, buildAuthLink,
  getUser, getAuthUserById,
  ensureMember, createGuestMember, isAdmin, isGateStaff, canViewRevenue,
  requireAdmin, requireAdminOrCron, requireGateAccess,
  safeError,
  buildMeResponse, formatDate, cancelCutoffOk,
  ownerStats, validatePromoCode, fulfillCheckoutSession,
  stationLabelsN, sectionCapN,
  POINTS_PER_RUN, POINTS_PER_BOOTCAMP, pointsByMember, memberPoints
};
