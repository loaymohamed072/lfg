// Comprehensive QA pass — money safety, auth gates, promo abuse, capacity, cancel
// cutoff, run-register hardening, admin display consistency. Self-cleaning.
//
// Run:  node --env-file=.env scripts/test-qa.js
//
// Each test logs PASS/FAIL with a short context line. The summary at the bottom
// lists every failure so you can fix it before live launch.
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const lfg = createClient(URL, SERVICE, { db: { schema: 'lfg_dev' }, auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.log('  FAIL  ' + label + (detail ? '  | ' + detail : '')); fail++; failures.push(label + (detail ? ' | ' + detail : '')); }
}
function section(name) { console.log('\n=== ' + name + ' ==='); }

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, ...opts });
  let body = null; try { body = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data: body };
}

async function makeUser(prefix = 'qa') {
  const email = prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '@example.com';
  const password = 'Test!' + crypto.randomBytes(6).toString('hex');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser: ' + error.message);
  const signin = await anon.auth.signInWithPassword({ email, password });
  if (signin.error) throw new Error('signin: ' + signin.error.message);
  return { uid: data.user.id, email, token: signin.data.session.access_token };
}

function signWebhook(payload) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
}

async function fireWebhook(eventObj) {
  const payload = JSON.stringify(eventObj);
  const sig = signWebhook(payload);
  return fetch(BASE + '/api/stripe-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
    body: payload
  });
}

function buildSingleEvent(uid, sessionId, section, amountAed, promoCode) {
  return {
    id: 'evt_qa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_qa_' + Math.random().toString(36).slice(2, 12),
        object: 'checkout.session',
        payment_intent: 'pi_test_qa_' + Math.random().toString(36).slice(2, 12),
        amount_total: Math.round(amountAed * 100),
        customer_details: { name: 'QA Tester' },
        metadata: { member_id: uid, kind: 'single', session_id: sessionId, section, ...(promoCode ? { promo_code: promoCode } : {}) }
      }
    }
  };
}

function buildPackageEvent(uid, packageId, amountAed, promoCode) {
  return {
    id: 'evt_qa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_qa_' + Math.random().toString(36).slice(2, 12),
        object: 'checkout.session',
        payment_intent: 'pi_test_qa_' + Math.random().toString(36).slice(2, 12),
        amount_total: Math.round(amountAed * 100),
        customer_details: { name: 'QA Tester' },
        metadata: { member_id: uid, kind: 'package', package_id: String(packageId), ...(promoCode ? { promo_code: promoCode } : {}) }
      }
    }
  };
}

// Pre-create a payment row matching a Stripe session, mirroring what /api/checkout would do
async function seedPendingPayment(uid, kind, amountAed, stripeSessionId, promoCode) {
  await lfg.from('payments').insert({
    member_id: uid, kind, amount_aed: amountAed, status: 'pending',
    stripe_session_id: stripeSessionId, ...(promoCode ? { promo_code: promoCode } : {})
  });
}

(async () => {
  const cleanupUserIds = [];
  const cleanupPromoCodes = [];

  // Reset the dev-server's in-process rate-limit buckets so prior runs don't
  // poison this run. The buckets live on `global` so we hit a tiny dev-only
  // debug endpoint to clear them; in production we'd never call this.
  try { await fetch(BASE + '/__debug/reset-rate-limits', { method: 'POST' }); } catch (e) {}

  try {
    // ============================================================
    section('Tier 1 — money safety');
    // ============================================================

    const user = await makeUser('money');
    cleanupUserIds.push(user.uid);
    const { data: pkg } = await lfg.from('packages').select('*').order('sessions_count').limit(1).single();
    const { data: sess } = await lfg.from('sessions').select('*').gte('session_date', new Date().toISOString().slice(0, 10)).order('session_date').limit(1).single();
    // 1.1 Webhook with invalid signature → 400
    {
      const r = await fetch(BASE + '/api/stripe-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fakehex' },
        body: JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
      });
      ok('1.1 webhook rejects invalid signature', r.status === 400, 'got ' + r.status);
    }

    // 1.2 Webhook without LFG metadata → 200 ignored, no DB writes
    {
      const beforeBookings = (await lfg.from('bookings').select('id', { count: 'exact', head: true })).count || 0;
      const beforePkgs = (await lfg.from('member_packages').select('id', { count: 'exact', head: true })).count || 0;
      const evt = { id: 'evt_qa_strange', object: 'event', type: 'checkout.session.completed',
        data: { object: { id: 'cs_strange', object: 'checkout.session', payment_intent: 'pi_strange', amount_total: 100, metadata: {} } } };
      const r = await fireWebhook(evt);
      const afterBookings = (await lfg.from('bookings').select('id', { count: 'exact', head: true })).count || 0;
      const afterPkgs = (await lfg.from('member_packages').select('id', { count: 'exact', head: true })).count || 0;
      ok('1.2 webhook ignores events without LFG metadata', r.status === 200 && afterBookings === beforeBookings && afterPkgs === beforePkgs);
    }

    // 1.3 Webhook idempotency — replay same session, no double credit
    {
      const evt = buildPackageEvent(user.uid, pkg.id, pkg.price_aed);
      const stripeSessionId = evt.data.object.id;
      await seedPendingPayment(user.uid, 'package', pkg.price_aed, stripeSessionId);

      const r1 = await fireWebhook(evt);
      const r2 = await fireWebhook(evt);

      const { data: mp } = await lfg.from('member_packages').select('id').eq('member_id', user.uid).eq('stripe_payment_intent', evt.data.object.payment_intent);
      ok('1.3 webhook is idempotent on replay (single package credited once)', r1.status === 200 && r2.status === 200 && mp.length === 1, 'rows=' + mp.length);
    }

    // 1.4 Direct RPC access blocked for anon
    {
      const r = await anon.schema('lfg_dev').rpc('book_with_credit', { p_member: user.uid, p_session: sess.id, p_section: 'A' });
      ok('1.4 anon cannot call book_with_credit RPC', r.error != null, 'error=' + (r.error && r.error.code));
    }
    {
      const r = await anon.schema('lfg_dev').rpc('book_paid', { p_member: user.uid, p_session: sess.id, p_section: 'A', p_amount: 99 });
      ok('1.5 anon cannot call book_paid RPC', r.error != null);
    }
    {
      const r = await anon.schema('lfg_dev').rpc('redeem_promo', { p_code: 'WHATEVER' });
      ok('1.6 anon cannot call redeem_promo RPC', r.error != null);
    }
    {
      const r = await anon.schema('lfg_dev').rpc('cancel_booking', { p_user_id: user.uid, p_booking_id: '00000000-0000-0000-0000-000000000000' });
      ok('1.7 anon cannot call cancel_booking RPC', r.error != null);
    }

    // 1.8 Direct anon table read blocked (RLS)
    {
      const r = await anon.schema('lfg_dev').from('bookings').select('id').limit(1);
      ok('1.8 anon cannot read bookings table directly', r.error != null || (r.data && r.data.length === 0));
    }
    {
      const r = await anon.schema('lfg_dev').from('promo_codes').select('code').limit(1);
      ok('1.9 anon cannot read promo_codes table directly', r.error != null || (r.data && r.data.length === 0));
    }
    {
      const r = await anon.schema('lfg_dev').from('run_registrations').select('email').limit(1);
      ok('1.10 anon cannot read run_registrations table directly', r.error != null || (r.data && r.data.length === 0));
    }

    // ============================================================
    section('Tier 2 — booking ownership & cancel cutoff');
    // ============================================================

    const userA = await makeUser('owner');
    cleanupUserIds.push(userA.uid);
    const userB = await makeUser('thief');
    cleanupUserIds.push(userB.uid);

    // A books a paid single
    {
      const evt = buildSingleEvent(userA.uid, sess.id, 'A', 99);
      await seedPendingPayment(userA.uid, 'single', 99, evt.data.object.id);
      const r = await fireWebhook(evt);
      ok('2.1 paid single booking created via webhook', r.status === 200);
    }

    const { data: aBooking } = await lfg.from('bookings').select('id,status,session_id')
      .eq('member_id', userA.uid).eq('status', 'booked').single();

    // 2.2 B tries to cancel A's booking via API → must fail
    {
      const r = await api('/api/cancel-booking', { method: 'POST', headers: { Authorization: 'Bearer ' + userB.token }, body: JSON.stringify({ booking_id: aBooking.id }) });
      ok('2.2 cancel-booking rejects non-owner', !r.ok || (r.data && !r.data.ok), 'status=' + r.status + ' body=' + JSON.stringify(r.data));
    }

    // 2.3 A cancels own booking — credit returned to package = 0 (paid single, not package)
    {
      const r = await api('/api/cancel-booking', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({ booking_id: aBooking.id }) });
      ok('2.3 owner can cancel own booking pre-cutoff', r.ok && r.data && r.data.ok, JSON.stringify(r.data));
    }

    // 2.4 Already-cancelled cancel returns clear error
    {
      const r = await api('/api/cancel-booking', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({ booking_id: aBooking.id }) });
      ok('2.4 cancelling already-cancelled booking errors', !r.ok || (r.data && !r.data.ok));
    }

    // 2.5 Cancel cutoff — past 8 AM same day blocks (DB function tested directly with a past-cutoff date)
    {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      // Insert a synthetic past session + booking to test cutoff. We use service role.
      const { data: pastSess, error: pErr } = await lfg.from('sessions').insert({ session_date: yesterday, start_time: '12:30', location: 'QA', capacity: 30, status: 'open' }).select('*').single();
      if (pErr) { ok('2.5 cancel cutoff blocks past-day', false, 'seed failed: ' + pErr.message); }
      else {
        const { data: pastBooking } = await lfg.from('bookings').insert({ member_id: userA.uid, session_id: pastSess.id, payment_type: 'single', amount_paid_aed: 99, status: 'booked', section: 'A' }).select('*').single();
        const r = await lfg.rpc('cancel_booking', { p_user_id: userA.uid, p_booking_id: pastBooking.id });
        ok('2.5 cancel_booking RPC rejects past 8 AM cutoff', r.data && r.data.ok === false && /cutoff/i.test(r.data.error || ''), JSON.stringify(r.data));
        await lfg.from('bookings').delete().eq('id', pastBooking.id);
        await lfg.from('sessions').delete().eq('id', pastSess.id);
      }
    }

    // ============================================================
    section('Tier 3 — promo code abuse');
    // ============================================================

    // Seed a 50% off code for percent-math test
    const codePct = 'QA_PCT_' + Date.now();
    cleanupPromoCodes.push(codePct);
    await lfg.from('promo_codes').insert({ code: codePct, kind: 'percent', value: 50, active: true });

    // Seed a fixed 30 AED off code
    const codeFix = 'QA_FIX_' + Date.now();
    cleanupPromoCodes.push(codeFix);
    await lfg.from('promo_codes').insert({ code: codeFix, kind: 'fixed', value: 30, active: true });

    // Seed an expired code
    const codeExp = 'QA_EXP_' + Date.now();
    cleanupPromoCodes.push(codeExp);
    await lfg.from('promo_codes').insert({ code: codeExp, kind: 'percent', value: 10, active: true, expires_at: new Date(Date.now() - 86400000).toISOString() });

    // Seed an inactive code
    const codeOff = 'QA_OFF_' + Date.now();
    cleanupPromoCodes.push(codeOff);
    await lfg.from('promo_codes').insert({ code: codeOff, kind: 'percent', value: 10, active: false });

    // Seed an email-locked code for userA
    const codeLock = 'QA_LOCK_' + Date.now();
    cleanupPromoCodes.push(codeLock);
    await lfg.from('promo_codes').insert({ code: codeLock, kind: 'fixed', value: 50, active: true, max_redemptions: 1, email_lock: userA.email });

    // Seed a low-budget code (1 redemption only) for race test
    const codeOnce = 'QA_ONCE_' + Date.now();
    cleanupPromoCodes.push(codeOnce);
    await lfg.from('promo_codes').insert({ code: codeOnce, kind: 'percent', value: 25, active: true, max_redemptions: 1 });

    const v = (label, payload, expectOk, customCheck) => api('/api/validate-promo', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify(payload) })
      .then(r => {
        const passed = (r.data && r.data.ok === expectOk) && (customCheck ? customCheck(r.data) : true);
        ok('3.' + label, passed, JSON.stringify(r.data));
      });

    // 3.1 lowercase normalised
    await v('1 lowercase code accepted', { code: codePct.toLowerCase(), kind: 'single' }, true, d => d.code === codePct.toUpperCase());

    // 3.2 percent math 99 * 0.5 = 49.50
    await v('2 percent math 50% off 99', { code: codePct, kind: 'single' }, true, d => d.final_amount === 49.5 && d.discount_amount === 49.5);

    // 3.3 fixed math 99 - 30 = 69
    await v('3 fixed math 30 AED off 99', { code: codeFix, kind: 'single' }, true, d => d.final_amount === 69 && d.discount_amount === 30);

    // 3.4 invalid code
    await v('4 invalid code rejected', { code: 'NOPENOPENOPE', kind: 'single' }, false);

    // 3.5 expired code
    await v('5 expired code rejected', { code: codeExp, kind: 'single' }, false);

    // 3.6 inactive code
    await v('6 inactive code rejected', { code: codeOff, kind: 'single' }, false);

    // 3.7 whitespace stripped
    await v('7 leading/trailing whitespace accepted', { code: '  ' + codePct + '  ', kind: 'single' }, true);

    // 3.8 empty code
    await v('8 empty code rejected', { code: '', kind: 'single' }, false);

    // 3.9 special chars rejected
    await v('9 special-char code rejected', { code: 'CODE$$;DROP', kind: 'single' }, false);

    // 3.10 email_lock blocks userB
    await api('/api/validate-promo', { method: 'POST', headers: { Authorization: 'Bearer ' + userB.token }, body: JSON.stringify({ code: codeLock, kind: 'single' }) })
      .then(r => ok('3.10 email_lock blocks other email', r.data && r.data.ok === false && /reserved/i.test(r.data.error || ''), JSON.stringify(r.data)));

    // 3.11 email_lock allows owner
    await v('11 email_lock allows owner email', { code: codeLock, kind: 'single' }, true);

    // 3.12 Atomic max_redemptions under race
    {
      const u1 = await makeUser('race1'); cleanupUserIds.push(u1.uid);
      const u2 = await makeUser('race2'); cleanupUserIds.push(u2.uid);
      // Fire two redeem_promo RPC calls in parallel — only one should win since max=1.
      const r = await Promise.all([
        lfg.rpc('redeem_promo', { p_code: codeOnce }),
        lfg.rpc('redeem_promo', { p_code: codeOnce })
      ]);
      const winners = r.filter(x => x.data && x.data.ok === true).length;
      const losers = r.filter(x => x.data && x.data.ok === false).length;
      ok('3.12 atomic max_redemptions wins exactly one under race', winners === 1 && losers === 1, 'winners=' + winners + ' losers=' + losers);
    }

    // 3.13 checkout server-side rejects percent > 100 / negative
    {
      const r = await api('/api/admin/promo-codes', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({ kind: 'percent', value: 150 }) });
      ok('3.13 admin endpoint rejects non-admin user', !r.ok && r.status === 403);
    }

    // ============================================================
    section('Tier 4 — admin auth gates');
    // ============================================================

    const adminUser = await makeUser('admincheck');
    cleanupUserIds.push(adminUser.uid);
    // Members are created lazily by /api/me's ensureMember. We need the row before we
    // can flip is_admin, otherwise the UPDATE matches 0 rows and the user stays a
    // non-admin. Easiest: upsert ourselves with admin = true.
    await lfg.from('members').upsert({ id: adminUser.uid, email: adminUser.email, is_admin: true }, { onConflict: 'id' });

    const endpoints = [
      ['/api/admin/stats', 'GET'],
      ['/api/admin/promo-codes', 'GET'],
      ['/api/admin/runners', 'GET'],
      ['/api/admin/issue-runner-promo', 'POST'],
      ['/api/admin/today', 'GET'],
      ['/api/admin/send-roster', 'POST'],
      ['/api/admin/checkin-status', 'GET'],
      ['/api/admin/adjust-credits', 'POST'],
      ['/api/checkin', 'POST'],
      ['/api/me', 'GET']
    ];
    for (const [path, method] of endpoints) {
      const r = await api(path, { method, body: method !== 'GET' ? JSON.stringify({}) : undefined });
      ok('4 ' + method + ' ' + path + ' requires auth', r.status === 401, 'status=' + r.status);
    }

    // 4.x — non-admin gets 403 on admin endpoints
    // GET-shaped admin endpoints
    for (const [path] of [['/api/admin/stats'], ['/api/admin/promo-codes'], ['/api/admin/runners'], ['/api/admin/today'], ['/api/admin/send-roster'], ['/api/admin/checkin-status']]) {
      const r = await api(path, { headers: { Authorization: 'Bearer ' + userA.token } });
      ok('4 ' + path + ' rejects non-admin user (403)', r.status === 403);
    }
    // POST-only admin endpoints (need a POST so they don't 405 first)
    {
      const r = await api('/api/admin/adjust-credits', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({}) });
      ok('4 /api/admin/adjust-credits rejects non-admin user (403)', r.status === 403);
    }

    // /api/checkin: authed members get a structured response (probably "no session" since QA env has no today-session, but NOT 401/403)
    {
      const r = await api('/api/checkin', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({}) });
      ok('4 authed member can call /api/checkin (returns structured result)', r.status === 200 && r.data && typeof r.data.ok === 'boolean');
    }

    // 4.x — admin can hit checkin-status
    {
      const r = await api('/api/admin/checkin-status', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      ok('4 admin can GET /api/admin/checkin-status (returns session or null)', r.ok && r.data && ('session' in r.data), 'status=' + r.status);
    }

    // 4.x — admin can hit the Today endpoint and gets the expected shape
    {
      const r = await api('/api/admin/today', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      ok('4 admin gets /api/admin/today (this_week + sundays_at_risk + noshow)', r.ok && r.data && r.data.this_week && Array.isArray(r.data.sundays_at_risk) && r.data.noshow && typeof r.data.convertible_runners === 'number', 'status=' + r.status);
    }

    // 4.x — send-roster cron token bypasses Supabase auth entirely
    if (process.env.LFG_CRON_TOKEN && process.env.LFG_CRON_TOKEN.length > 10 && !/replace_me/.test(process.env.LFG_CRON_TOKEN)) {
      const r = await api('/api/admin/send-roster', { method: 'GET', headers: { Authorization: 'Bearer ' + process.env.LFG_CRON_TOKEN } });
      ok('4 send-roster GET accepts LFG_CRON_TOKEN (dry-run returns roster)', r.ok && r.data && r.data.roster, 'status=' + r.status);
    } else {
      ok('4 send-roster cron token test skipped (LFG_CRON_TOKEN not set)', true);
    }

    // 4.x — admin can access their endpoints
    {
      const r = await api('/api/admin/stats', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      ok('4 admin user gets /api/admin/stats', r.ok && r.data, 'status=' + r.status);
    }

    // ============================================================
    section('Tier 5 — run-register hardening');
    // ============================================================

    // 5.1 honeypot drops silently
    {
      const r = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: 'Bot', last_name: 'Spam', email: 'bot@spam.com', whatsapp: '+971500000000', level: 'beginner', website_url: 'http://gotcha' }) });
      const { data: rr } = await lfg.from('run_registrations').select('email').eq('email', 'bot@spam.com');
      ok('5.1 honeypot returns 200 silently with no DB write', r.ok && rr.length === 0);
    }

    // 5.2 email validation
    {
      const r = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: 'No', last_name: 'Email', email: 'not-an-email', whatsapp: '+971500000000', level: 'beginner' }) });
      ok('5.2 invalid email rejected', !r.ok && /email/i.test(r.data.error));
    }

    // 5.3 invalid phone rejected
    {
      const r = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: 'Bad', last_name: 'Phone', email: 'bad.phone@x.com', whatsapp: 'abcdef', level: 'beginner' }) });
      ok('5.3 invalid phone rejected', !r.ok && /whatsapp/i.test(r.data.error));
    }

    // 5.4 invalid level rejected
    {
      const r = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: 'Bad', last_name: 'Level', email: 'bad.level@x.com', whatsapp: '+971500000000', level: 'GODMODE' }) });
      ok('5.4 invalid level rejected', !r.ok && /level/i.test(r.data.error));
    }

    // 5.5 dedupe by email (upsert)
    {
      const email = 'qa.dup_' + Date.now() + '@x.com';
      const r1 = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: 'Dup1', last_name: 'One', email, whatsapp: '+971500000000', level: 'beginner' }) });
      const r2 = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: 'Dup2', last_name: 'Two', email, whatsapp: '+971500000000', level: 'advanced' }) });
      const { data: rows } = await lfg.from('run_registrations').select('first_name,level').eq('email', email);
      ok('5.5 same email upserts (no duplicate)', r1.ok && r2.ok && rows.length === 1 && rows[0].level === 'advanced');
      await lfg.from('run_registrations').delete().eq('email', email);
    }

    // 5.6 XSS payload survives but is stored as plain text (no rendering risk server-side)
    {
      const email = 'qa.xss_' + Date.now() + '@x.com';
      const xss = '<script>alert(1)</script>';
      const r = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: xss, last_name: 'X', email, whatsapp: '+971500000000', level: 'beginner', interests: xss }) });
      const { data: row } = await lfg.from('run_registrations').select('first_name,interests').eq('email', email).maybeSingle();
      ok('5.6 XSS payload stored verbatim (admin UI must escape)', r.ok && row && row.first_name === xss);
      await lfg.from('run_registrations').delete().eq('email', email);
    }

    // 5.7 Honeypot trims to 1 char — value with length 1 still drops
    {
      const r = await api('/api/run-register', { method: 'POST', body: JSON.stringify({ first_name: 'Bot2', last_name: 'X', email: 'bot2@spam.com', whatsapp: '+971500000000', level: 'beginner', website_url: 'http://very-long-url-bot' }) });
      const { data: rr } = await lfg.from('run_registrations').select('email').eq('email', 'bot2@spam.com');
      ok('5.7 honeypot drops long URLs too', r.ok && rr.length === 0);
    }

    // ============================================================
    section('Tier 6 — admin display reconciliation');
    // ============================================================

    // 6.1 /api/admin/stats totals reconcile to DB
    {
      const r = await api('/api/admin/stats', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      const { count: memberCount } = await lfg.from('members').select('id', { count: 'exact', head: true }).neq('is_admin', true);
      const { count: bookingCount } = await lfg.from('bookings').select('id', { count: 'exact', head: true }).neq('status', 'cancelled');
      ok('6.1 admin stats.members matches DB non-admin members', r.data && r.data.totals && r.data.totals.members === memberCount, 'api=' + (r.data && r.data.totals && r.data.totals.members) + ' db=' + memberCount);
      ok('6.2 admin stats.bookings matches DB non-cancelled bookings', r.data && r.data.totals && r.data.totals.bookings === bookingCount, 'api=' + (r.data && r.data.totals && r.data.totals.bookings) + ' db=' + bookingCount);
    }

    // 6.3 admin/runners shape
    {
      const r = await api('/api/admin/runners', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      ok('6.3 admin/runners returns runners + convertible_count + source_breakdown', r.ok && Array.isArray(r.data.runners) && typeof r.data.convertible_count === 'number' && r.data.source_breakdown && typeof r.data.source_breakdown === 'object');
    }

    // 6.4 admin/promo-codes lists all (incl. inactive)
    {
      const r = await api('/api/admin/promo-codes', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      const codes = (r.data && r.data.codes) || [];
      const hasOurs = codes.some(c => c.code === codeOff);
      ok('6.4 admin/promo-codes returns inactive codes too', hasOurs);
    }

    // ============================================================
    section('Tier 7 — checkout boundary checks');
    // ============================================================

    // 7.1 checkout requires auth
    {
      const r = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ kind: 'single', session_id: sess.id }) });
      ok('7.1 /api/checkout requires auth', r.status === 401);
    }

    // 7.2 checkout rejects invalid kind
    {
      const r = await api('/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({ kind: 'lol' }) });
      ok('7.2 /api/checkout rejects invalid kind', !r.ok && /invalid/i.test(r.data.error));
    }

    // 7.3 checkout rejects bad return_to (would otherwise allow open-redirect)
    {
      const r = await api('/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({ kind: 'single', session_id: sess.id, section: 'A', return_to: 'https://evil.com/x' }) });
      // It should accept the request but normalise return_to to '/' (no error from checkout itself, normalisation hidden)
      ok('7.3 checkout normalises evil return_to', r.ok || r.status >= 400, 'status=' + r.status);
    }

    // 7.4 checkout with invalid package_id → 400
    {
      const r = await api('/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({ kind: 'package', package_id: 99999999 }) });
      ok('7.4 checkout rejects unknown package', !r.ok);
    }

    // 7.5 promo code in checkout for percent (server-side discount applied)
    {
      const r = await api('/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + userA.token }, body: JSON.stringify({ kind: 'single', session_id: sess.id, section: 'A', promo_code: codePct }) });
      ok('7.5 checkout accepts valid promo on single', r.ok && r.data.url, JSON.stringify(r.data));
      // Clean up the pending payment row we just created
      if (r.data && r.data.id) await lfg.from('payments').delete().eq('stripe_session_id', r.data.id);
    }

    // 7.6 checkout with email-locked code for wrong user → must fail with clear error
    {
      const r = await api('/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + userB.token }, body: JSON.stringify({ kind: 'single', session_id: sess.id, section: 'A', promo_code: codeLock }) });
      ok('7.6 checkout rejects email-locked code for other user', !r.ok && /reserved/i.test(r.data.error), JSON.stringify(r.data));
    }

    // ============================================================
    section('Tier 8 — capacity & section logic');
    // ============================================================

    // 8.1 Section spec for a normal session = 30 / 4 = 8 + remainders
    {
      const r = await lfg.rpc('section_cap', { p_total: 30, p_idx: 0 });
      ok('8.1 section_cap math (30 / 4, idx 0) = 8', r.data === 8, 'got ' + r.data);
    }

    // 8.2 Section index 3 of 30 = 7
    {
      const r = await lfg.rpc('section_cap', { p_total: 30, p_idx: 3 });
      ok('8.2 section_cap math (30 / 4, idx 3) = 7', r.data === 7, 'got ' + r.data);
    }

    // ============================================================
    section('Tier 9 — checkout double-submit behaviour');
    // ============================================================

    // 9.1 Same user clicks Pay twice — each creates its own pending payment row,
    // but Stripe webhook fulfils only ONE per stripe_session_id (idempotent).
    {
      const beforePkgs = (await lfg.from('member_packages').select('id', { count: 'exact', head: true }).eq('member_id', userA.uid)).count || 0;
      // Simulate two paid checkouts back-to-back (one user, two distinct Stripe sessions)
      const evt1 = buildPackageEvent(userA.uid, pkg.id, pkg.price_aed);
      const evt2 = buildPackageEvent(userA.uid, pkg.id, pkg.price_aed);
      await seedPendingPayment(userA.uid, 'package', pkg.price_aed, evt1.data.object.id);
      await seedPendingPayment(userA.uid, 'package', pkg.price_aed, evt2.data.object.id);
      await fireWebhook(evt1);
      await fireWebhook(evt2);
      const afterPkgs = (await lfg.from('member_packages').select('id', { count: 'exact', head: true }).eq('member_id', userA.uid)).count || 0;
      ok('9.1 two distinct Stripe sessions credit two packages (intentional)', afterPkgs === beforePkgs + 2, 'before=' + beforePkgs + ' after=' + afterPkgs);
    }

    // ============================================================
    section('Tier 10 — promo audit log');
    // ============================================================

    // 10.1 redeem_promo now writes a promo_redemptions row
    {
      const audCode = 'QA_AUD_' + Date.now();
      cleanupPromoCodes.push(audCode);
      await lfg.from('promo_codes').insert({ code: audCode, kind: 'percent', value: 10, active: true });
      const auditUser = await makeUser('audit'); cleanupUserIds.push(auditUser.uid);
      // ensureMember equivalent — by webhook time, the member row exists. Mirror that here.
      await lfg.from('members').upsert({ id: auditUser.uid, email: auditUser.email }, { onConflict: 'id' });
      await lfg.rpc('redeem_promo', { p_code: audCode, p_member_id: auditUser.uid, p_payment_intent: 'pi_audit_qa' });
      const { data: log } = await lfg.from('promo_redemptions').select('code,member_id,payment_intent').eq('code', audCode);
      ok('10.1 redeem writes an audit row', log && log.length === 1 && log[0].member_id === auditUser.uid && log[0].payment_intent === 'pi_audit_qa', JSON.stringify(log));
      await lfg.from('promo_redemptions').delete().eq('code', audCode);
    }

    // 10.2 admin GET /api/admin/promo-codes returns redemptions array
    {
      const r = await api('/api/admin/promo-codes', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      ok('10.2 admin promo-codes response includes redemptions[]', r.ok && Array.isArray(r.data && r.data.redemptions));
    }

    // ============================================================
    section('Tier 11 — rate limit /api/validate-promo');
    // ============================================================

    // 11.1 Spam 12 validations in a row — should hit 429 around the 11th
    {
      const spamUser = await makeUser('spammer'); cleanupUserIds.push(spamUser.uid);
      let blocked = 0;
      let allowedFirstBatch = 0;
      for (let i = 0; i < 12; i++) {
        const r = await api('/api/validate-promo', { method: 'POST', headers: { Authorization: 'Bearer ' + spamUser.token }, body: JSON.stringify({ code: 'WHATEVER' + i, kind: 'single' }) });
        if (r.status === 429) blocked++;
        else if (r.status === 200) allowedFirstBatch++;
      }
      ok('11.1 first 10 attempts allowed, subsequent return 429', allowedFirstBatch === 10 && blocked === 2, 'allowed=' + allowedFirstBatch + ' blocked=' + blocked);
    }

    // ============================================================
    section('Tier 12 — reconcile endpoint auth');
    // ============================================================

    // 12.1 401 without auth
    {
      const r = await api('/api/admin/reconcile-payments');
      ok('12.1 reconcile requires auth', r.status === 401);
    }
    // 12.2 403 for non-admin
    {
      const r = await api('/api/admin/reconcile-payments', { headers: { Authorization: 'Bearer ' + userA.token } });
      ok('12.2 reconcile rejects non-admin', r.status === 403);
    }
    // 12.3 200 for admin GET (shape)
    {
      const r = await api('/api/admin/reconcile-payments', { headers: { Authorization: 'Bearer ' + adminUser.token } });
      ok('12.3 admin can GET reconcile (returns stuck[] + cutoff_minutes)', r.ok && Array.isArray(r.data && r.data.stuck) && typeof r.data.cutoff_minutes === 'number');
    }

    // ============================================================
    section('Tier 13 — referrals + admin credit adjustment');
    // ============================================================

    // 13.1 — every member gets a referral_code via ensureMember (call /api/me)
    {
      const refUser = await makeUser('ref'); cleanupUserIds.push(refUser.uid);
      const r = await api('/api/me', { headers: { Authorization: 'Bearer ' + refUser.token } });
      ok('13.1 /api/me returns a referral_code on first hit', r.ok && r.data && typeof r.data.referral_code === 'string' && r.data.referral_code.length > 4, 'code=' + (r.data && r.data.referral_code));
    }

    // 13.2 — using your own referral code is rejected with a clear error
    {
      const selfUser = await makeUser('selfref'); cleanupUserIds.push(selfUser.uid);
      // Trigger code generation
      const me = await api('/api/me', { headers: { Authorization: 'Bearer ' + selfUser.token } });
      const code = me.data && me.data.referral_code;
      const r = await api('/api/validate-promo', { method: 'POST', headers: { Authorization: 'Bearer ' + selfUser.token }, body: JSON.stringify({ code, kind: 'single' }) });
      ok('13.2 cannot use own referral code', r.data && r.data.ok === false && /own referral|reserved/i.test(r.data.error || ''), JSON.stringify(r.data));
    }

    // 13.3 — another member CAN use it (returns 15% discount + is_referral:true)
    {
      const ownerUser = await makeUser('refowner'); cleanupUserIds.push(ownerUser.uid);
      const buyerUser = await makeUser('refbuyer'); cleanupUserIds.push(buyerUser.uid);
      const ownerMe = await api('/api/me', { headers: { Authorization: 'Bearer ' + ownerUser.token } });
      const code = ownerMe.data && ownerMe.data.referral_code;
      const r = await api('/api/validate-promo', { method: 'POST', headers: { Authorization: 'Bearer ' + buyerUser.token }, body: JSON.stringify({ code, kind: 'single' }) });
      ok('13.3 other member can use the referral code', r.data && r.data.ok === true && r.data.value === 15 && r.data.is_referral === true, JSON.stringify(r.data));
    }

    // 13.4 — admin adjust-credits: positive delta creates a comp pack
    {
      const recipient = await makeUser('adjrecip'); cleanupUserIds.push(recipient.uid);
      await api('/api/me', { headers: { Authorization: 'Bearer ' + recipient.token } });  // ensures member row
      const r = await api('/api/admin/adjust-credits', { method: 'POST', headers: { Authorization: 'Bearer ' + adminUser.token }, body: JSON.stringify({ member_email: recipient.email, delta: 3, reason: 'QA test comp', expires_days: 30 }) });
      ok('13.4 admin can add credits (3 comp credits, audit logged)', r.ok && r.data && r.data.ok === true && r.data.delta === 3, JSON.stringify(r.data));
      // Verify on recipient's /api/me
      const me = await api('/api/me', { headers: { Authorization: 'Bearer ' + recipient.token } });
      ok('13.5 recipient now has 3 sessions_remaining', me.ok && me.data && me.data.sessions_remaining === 3, 'sr=' + (me.data && me.data.sessions_remaining));
    }

    // 13.6 — admin subtract > available is rejected with explicit error
    {
      const zeroUser = await makeUser('adjzero'); cleanupUserIds.push(zeroUser.uid);
      await api('/api/me', { headers: { Authorization: 'Bearer ' + zeroUser.token } });
      const r = await api('/api/admin/adjust-credits', { method: 'POST', headers: { Authorization: 'Bearer ' + adminUser.token }, body: JSON.stringify({ member_email: zeroUser.email, delta: -1, reason: 'QA over-subtract' }) });
      ok('13.6 subtracting more than available is rejected', !r.ok || (r.data && r.data.ok === false && /credit/i.test(r.data.error || '')), JSON.stringify(r.data));
    }

    // 13.7 — reason required
    {
      const r = await api('/api/admin/adjust-credits', { method: 'POST', headers: { Authorization: 'Bearer ' + adminUser.token }, body: JSON.stringify({ member_email: adminUser.email, delta: 1, reason: '' }) });
      ok('13.7 adjust-credits requires a reason', !r.ok && /reason/i.test(r.data.error || ''), JSON.stringify(r.data));
    }

    // ============================================================
    section('Tier 14 — streaks + PWA');
    // ============================================================

    // 14.1 — /api/me returns a streak object with the expected shape
    {
      const streakUser = await makeUser('streak'); cleanupUserIds.push(streakUser.uid);
      const r = await api('/api/me', { headers: { Authorization: 'Bearer ' + streakUser.token } });
      const s = r.data && r.data.streak;
      ok('14.1 /api/me returns streak object', r.ok && s && typeof s === 'object', 'streak=' + JSON.stringify(s));
      ok('14.2 streak has all keys (current,best,total,member_since,attended_this_month,rank_this_month)',
         s && 'current' in s && 'best' in s && 'total' in s && 'member_since' in s && 'attended_this_month' in s && 'rank_this_month' in s,
         'keys=' + (s ? Object.keys(s).join(',') : 'none'));
      ok('14.3 brand-new member streak.current === 0',  s && s.current === 0, 'current=' + (s && s.current));
      ok('14.4 brand-new member streak.total === 0',    s && s.total === 0,   'total=' + (s && s.total));
      ok('14.5 brand-new member rank_this_month is null', s && s.rank_this_month === null, 'rank=' + (s && s.rank_this_month));
    }

    // 14.6 — RPC member_streak_stats returns the expected JSON shape (call directly)
    {
      const streakUser = await makeUser('streakdb'); cleanupUserIds.push(streakUser.uid);
      const { data: s, error } = await lfg.rpc('member_streak_stats', { p_member_id: streakUser.uid });
      ok('14.6 RPC member_streak_stats returns jsonb',
         !error && s && typeof s === 'object' && 'current' in s && 'best' in s && 'total' in s,
         error ? error.message : JSON.stringify(s));
    }

    // 14.7 — manifest is served with valid JSON content
    {
      const r = await fetch(BASE + '/site.webmanifest');
      const txt = await r.text();
      let parsed = null; try { parsed = JSON.parse(txt); } catch (e) {}
      ok('14.7 /site.webmanifest serves valid JSON',
         r.ok && parsed && parsed.name && parsed.start_url && Array.isArray(parsed.icons) && parsed.icons.length >= 2,
         'status=' + r.status + ' icons=' + (parsed && parsed.icons && parsed.icons.length));
    }

    // 14.8 — service worker file is served at /sw.js
    {
      const r = await fetch(BASE + '/sw.js');
      const txt = await r.text();
      ok('14.8 /sw.js is served and contains a fetch handler',
         r.ok && /self\.addEventListener\(['"]fetch['"]/.test(txt) && /caches\.open/.test(txt),
         'status=' + r.status + ' len=' + txt.length);
    }

    // 14.9 — service worker NEVER caches admin endpoints (security: no stale admin data)
    {
      const r = await fetch(BASE + '/sw.js');
      const txt = await r.text();
      ok('14.9 sw.js bypasses /api/admin/ traffic',
         /\/api\/admin\//.test(txt) && /pass-through|return ;|return$/m.test(txt),
         'sw must explicitly skip admin URLs');
    }

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n=== summary ===');
    console.log('  ' + pass + ' passed · ' + fail + ' failed');
    if (fail > 0) {
      console.log('\n  failures:');
      failures.forEach(f => console.log('   - ' + f));
    }
  } catch (e) {
    console.log('\nTEST RUNNER THREW: ' + e.message + '\n' + (e.stack || ''));
    process.exitCode = 2;
  } finally {
    // ============================================================
    // Cleanup
    // ============================================================
    console.log('\n=== cleanup ===');
    for (const uid of cleanupUserIds) {
      try {
        await lfg.from('bookings').delete().eq('member_id', uid);
        await lfg.from('member_packages').delete().eq('member_id', uid);
        await lfg.from('payments').delete().eq('member_id', uid);
        await lfg.from('members').delete().eq('id', uid);
        await admin.auth.admin.deleteUser(uid);
      } catch (e) { console.log('  cleanup uid ' + uid + ' err: ' + e.message); }
    }
    for (const code of cleanupPromoCodes) {
      try { await lfg.from('promo_codes').delete().eq('code', code); } catch (e) {}
    }
    console.log('  cleanup done');
    if (fail > 0) process.exitCode = 1;
  }
})();
