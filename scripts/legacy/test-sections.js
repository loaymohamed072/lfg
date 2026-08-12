// Temporary section + auto-bump test (deleted after running).
const { createClient } = require('@supabase/supabase-js');
const URL = process.env.SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
const lfg = createClient(URL, SERVICE, { db: { schema: 'lfg_dev' }, auth: { persistSession: false } });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

async function mkUser(credits) {
  const email = 'lfgsec_' + Math.random().toString(36).slice(2, 9) + '@example.com';
  const password = 'Test!' + Math.random().toString(36).slice(2, 10);
  const { data: c } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const uid = c.user.id;
  await lfg.from('members').upsert({ id: uid, email });
  if (credits) {
    const exp = new Date(); exp.setMonth(exp.getMonth() + 2);
    await lfg.from('member_packages').insert({ member_id: uid, sessions_total: credits, sessions_remaining: credits, expires_at: exp.toISOString(), status: 'active' });
  }
  const token = (await anon.auth.signInWithPassword({ email, password })).data.session.access_token;
  return { uid, token };
}
const book = (token, sid, section) => fetch('http://localhost:8080/api/book', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ session_id: sid, section })
}).then(async r => ({ status: r.status, body: await r.json() }));

(async () => {
  const { data: sess } = await lfg.from('sessions').select('id,session_date').order('session_date');
  const sA = sess[5], sB = sess[6]; // use later sessions to avoid loay's booking
  const created = [];

  // ---- TEST A: section balancing (capacity 8 => each section cap 2, bump off) ----
  await lfg.from('sessions').update({ capacity: 8, bump_threshold: 0 }).eq('id', sA.id);
  console.log('TEST A — section balancing on', sA.session_date, '(cap 8 -> 2 per section)');
  const u1 = await mkUser(2), u2 = await mkUser(2), u3 = await mkUser(2);
  created.push(u1.uid, u2.uid, u3.uid);
  console.log(' u1 -> A:', JSON.stringify((await book(u1.token, sA.id, 'A')).body));
  console.log(' u2 -> A:', JSON.stringify((await book(u2.token, sA.id, 'A')).body));
  let r = await book(u3.token, sA.id, 'A');
  console.log(' u3 -> A (should be full):', r.status, JSON.stringify(r.body));
  console.log(' u3 -> B (should work):', JSON.stringify((await book(u3.token, sA.id, 'B')).body));

  // ---- TEST B: auto-bump (capacity 4, threshold 5 => bumps on first booking) ----
  await lfg.from('sessions').update({ capacity: 4, bump_threshold: 5, bump_increment: 10, max_capacity: 100 }).eq('id', sB.id);
  console.log('\\nTEST B — auto-bump on', sB.session_date, '(cap 4, threshold 5, +10)');
  const capBefore = (await lfg.from('sessions').select('capacity').eq('id', sB.id).single()).data.capacity;
  const u4 = await mkUser(1); created.push(u4.uid);
  console.log(' u4 -> A:', JSON.stringify((await book(u4.token, sB.id, 'A')).body));
  const capAfter = (await lfg.from('sessions').select('capacity').eq('id', sB.id).single()).data.capacity;
  console.log(' capacity ' + capBefore + ' -> ' + capAfter, capAfter === 14 ? '✓ (bumped +10)' : '✗');

  // ---- check /api/sessions section payload ----
  const s = (await fetch('http://localhost:8080/api/sessions').then(r => r.json())).sessions.find(x => x.id === sA.id);
  console.log('\\n/api/sessions for', sA.session_date, '-> spots_left', s.spots_left, '| sections:', JSON.stringify(s.sections));

  // cleanup
  for (const uid of created) await admin.auth.admin.deleteUser(uid);
  await lfg.from('sessions').update({ capacity: 30, bump_threshold: 5, bump_increment: 10, max_capacity: 100 }).in('id', [sA.id, sB.id]);
  console.log('\\nCleaned up users + restored sessions');
})().catch(e => { console.log('THROW:', e.message); process.exit(1); });
