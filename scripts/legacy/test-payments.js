// Temporary end-to-end payment test (deleted after running).
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const URL = process.env.SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const lfg = createClient(URL, SERVICE, { db: { schema: 'lfg_dev' }, auth: { persistSession: false } });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const email = 'lfgpay_' + Date.now() + '@example.com';
  const password = 'Test!' + Math.random().toString(36).slice(2, 10);
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw new Error('createUser: ' + cErr.message);
  const uid = created.user.id;
  const { data: signin, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error('signin: ' + sErr.message);
  const token = signin.session.access_token;

  const { data: pkg } = await lfg.from('packages').select('*').eq('sessions_count', 8).single();
  console.log('Package under test:', pkg.name, pkg.price_aed, 'AED, valid', pkg.validity_months, 'mo');

  // 1. checkout with promo LFG10 (10% off 658 = 592.20)
  const r1 = await fetch('http://localhost:8080/api/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ kind: 'package', package_id: pkg.id, promo_code: 'LFG10' })
  });
  const c = await r1.json();
  console.log('1. checkout -> HTTP', r1.status, c.url ? '(stripe url: ' + c.url.slice(0, 34) + '…)' : JSON.stringify(c));
  const sessionId = c.id;
  if (!sessionId) throw new Error('no session id');

  // 2. simulate signed webhook
  const event = {
    id: 'evt_test_' + Date.now(), object: 'event', type: 'checkout.session.completed',
    data: { object: { id: sessionId, object: 'checkout.session', payment_intent: 'pi_test_' + Date.now(),
      amount_total: Math.round(pkg.price_aed * 0.9 * 100),
      metadata: { member_id: uid, kind: 'package', package_id: String(pkg.id), promo_code: 'LFG10' } } }
  };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r2 = await fetch('http://localhost:8080/api/stripe-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload
  });
  console.log('2. webhook -> HTTP', r2.status, JSON.stringify(await r2.json()));

  // 3. credits via /api/me
  const r3 = await fetch('http://localhost:8080/api/me', { headers: { Authorization: 'Bearer ' + token } });
  console.log('3. /api/me ->', JSON.stringify(await r3.json()));

  // 4. raw rows
  const { data: mp } = await lfg.from('member_packages').select('sessions_total,sessions_remaining,expires_at,status').eq('member_id', uid);
  console.log('4. member_packages ->', JSON.stringify(mp));
  const { data: pay } = await lfg.from('payments').select('status,amount_aed,promo_code').eq('stripe_session_id', sessionId);
  console.log('   payment ->', JSON.stringify(pay));

  // 5. idempotency: replay webhook
  const r5 = await fetch('http://localhost:8080/api/stripe-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload
  });
  console.log('5. webhook replay ->', JSON.stringify(await r5.json()));
  const { data: mp2 } = await lfg.from('member_packages').select('id').eq('member_id', uid);
  console.log('   packages after replay:', mp2.length, mp2.length === 1 ? '✓ (no double credit)' : '✗ DOUBLE CREDIT BUG');

  // cleanup
  await admin.auth.admin.deleteUser(uid);
  await lfg.from('payments').delete().eq('stripe_session_id', sessionId);
  await lfg.from('promo_codes').update({ times_redeemed: 0 }).eq('code', 'LFG10');
  console.log('6. cleaned up test data');
})().catch(e => { console.log('THROW:', e.message); process.exit(1); });
