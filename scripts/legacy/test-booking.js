// Temporary booking-engine test (deleted after running).
const { createClient } = require('@supabase/supabase-js');
const URL = process.env.SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;

const post = (path, token, body) => fetch('http://localhost:8080' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body)
}).then(async r => ({ status: r.status, body: await r.json() }));
const get = (path, token) => fetch('http://localhost:8080' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }).then(r => r.json());

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const lfg = createClient(URL, SERVICE, { db: { schema: 'lfg_dev' }, auth: { persistSession: false } });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });

  const email = 'lfgbook_' + Date.now() + '@example.com';
  const password = 'Test!' + Math.random().toString(36).slice(2, 10);
  const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const uid = created.user.id;
  const token = (await anon.auth.signInWithPassword({ email, password })).data.session.access_token;

  // ensure member + give a 3-credit package (60-day)
  await lfg.from('members').upsert({ id: uid, email });
  const expires = new Date(); expires.setMonth(expires.getMonth() + 2);
  await lfg.from('member_packages').insert({ member_id: uid, sessions_total: 3, sessions_remaining: 3, expires_at: expires.toISOString(), status: 'active' });
  console.log('Setup: member + 3 credits');

  let s = (await get('/api/sessions', token)).sessions;
  console.log('Sessions returned:', s.length, '| first spots_left:', s[0].spots_left);

  // 1. book s0
  let r = await post('/api/book', token, { session_id: s[0].id });
  console.log('1. book s0 ->', r.status, JSON.stringify(r.body));

  // 2. double-book s0
  r = await post('/api/book', token, { session_id: s[0].id });
  console.log('2. re-book s0 ->', r.status, JSON.stringify(r.body));

  // 3. capacity full: set s3 capacity 0, book it (credit should NOT be consumed)
  await lfg.from('sessions').update({ capacity: 0 }).eq('id', s[3].id);
  r = await post('/api/book', token, { session_id: s[3].id });
  console.log('3. book full s3 ->', r.status, JSON.stringify(r.body));
  const remAfterFull = (await lfg.from('member_packages').select('sessions_remaining').eq('member_id', uid).single()).data.sessions_remaining;
  console.log('   credits after full attempt:', remAfterFull, remAfterFull === 2 ? '✓ (not consumed)' : '✗');
  await lfg.from('sessions').update({ capacity: 30 }).eq('id', s[3].id);

  // 4. book s1 (ok), s2 (ok -> depletes)
  r = await post('/api/book', token, { session_id: s[1].id });
  console.log('4. book s1 ->', r.status, JSON.stringify(r.body));
  r = await post('/api/book', token, { session_id: s[2].id });
  console.log('5. book s2 (last credit) ->', r.status, JSON.stringify(r.body));

  // 6. no credits left
  r = await post('/api/book', token, { session_id: s[4].id });
  console.log('6. book s4 (depleted) ->', r.status, JSON.stringify(r.body));

  // 7. spots-left + mine flags
  s = (await get('/api/sessions', token)).sessions;
  console.log('7. s0 spots_left:', s[0].spots_left, '| booked_by_me:', s[0].booked_by_me);

  // 8. /api/me bookings
  const me = await get('/api/me', token);
  console.log('8. /api/me -> credits:', me.sessions_remaining, '| upcoming bookings:', me.upcoming_bookings.length);

  // cleanup
  await admin.auth.admin.deleteUser(uid);
  console.log('9. cleaned up');
})().catch(e => { console.log('THROW:', e.message); process.exit(1); });
