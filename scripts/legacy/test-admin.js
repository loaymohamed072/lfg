// Admin dashboard test + demo-data seed. Writes admin session to /tmp for a screenshot.
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const URL = process.env.SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
const lfg = createClient(URL, SERVICE, { db: { schema: 'lfg_dev' }, auth: { persistSession: false } });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

async function mkUser(name, isAdmin) {
  const email = (isAdmin ? 'lfgadmin_' : 'lfgdemo_') + Math.random().toString(36).slice(2, 8) + '@example.com';
  const password = 'Test!' + Math.random().toString(36).slice(2, 10);
  const { data: c } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  const uid = c.user.id;
  await lfg.from('members').upsert({ id: uid, email, full_name: name, is_admin: !!isAdmin });
  const token = (await anon.auth.signInWithPassword({ email, password })).data.session.access_token;
  const session = (await anon.auth.signInWithPassword({ email, password })).data.session;
  return { uid, email, token, session };
}
const api = (path, token, method, body) => fetch('http://localhost:8080' + path, {
  method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
  body: body ? JSON.stringify(body) : undefined
});

(async () => {
  const created = [];
  const adminU = await mkUser('Owner Test', true); created.push(adminU.uid);
  const { data: sess } = await lfg.from('sessions').select('id,session_date').order('session_date');

  // 3 demo members with packages, payments, bookings
  const exp = new Date(); exp.setMonth(exp.getMonth() + 2);
  async function seed(name, pkgCredits, price, books, attendOne, lapsedDays) {
    const u = await mkUser(name, false); created.push(u.uid);
    if (pkgCredits) await lfg.from('member_packages').insert({ member_id: u.uid, sessions_total: pkgCredits, sessions_remaining: pkgCredits - books.length, expires_at: exp.toISOString(), status: 'active' });
    await lfg.from('payments').insert({ member_id: u.uid, amount_aed: price, kind: pkgCredits ? 'package' : 'single', status: 'paid', stripe_session_id: 'demo_' + u.uid });
    for (let i = 0; i < books.length; i++) {
      await lfg.from('bookings').insert({ member_id: u.uid, session_id: sess[books[i]].id, section: ['A', 'B', 'C', 'D'][i % 4], payment_type: pkgCredits ? 'credit' : 'single', status: (attendOne && i === 0) ? 'attended' : 'booked' });
    }
    if (lapsedDays) {
      const old = new Date(Date.now() - lapsedDays * 864e5).toISOString();
      await lfg.from('bookings').update({ booked_at: old }).eq('member_id', u.uid);
    }
    return u;
  }
  await seed('Sara K', 8, 658, [1, 2], true, 0);
  await seed('Omar T', 4, 368, [3], false, 0);
  await seed('Lina M', 0, 99, [4], false, 40); // single, lapsed

  // ---- assertions ----
  const sR = await api('/api/admin/stats', adminU.token); const stats = await sR.json();
  console.log('stats HTTP', sR.status);
  console.log(' totals:', JSON.stringify(stats.totals));
  console.log(' members rows:', stats.members.length, '| sessions:', stats.sessions.length);

  const eR = await api('/api/admin/export', adminU.token);
  const csv = await eR.text();
  console.log('export HTTP', eR.status, '| csv lines:', csv.split('\\n').length, '| header:', csv.split('\\r\\n')[0]);

  const capR = await api('/api/admin/set-capacity', adminU.token, 'POST', { session_id: sess[0].id, capacity: 40 });
  console.log('set-capacity HTTP', capR.status, JSON.stringify(await capR.json()));

  const nonAdmin = await mkUser('Random', false); created.push(nonAdmin.uid);
  const fR = await api('/api/admin/stats', nonAdmin.token);
  console.log('non-admin stats HTTP', fR.status, '(expect 403)');

  // write admin session for screenshot
  fs.writeFileSync('/tmp/lfg-admin-session.json', JSON.stringify(adminU.session));
  fs.writeFileSync('/tmp/lfg-cleanup-uids.json', JSON.stringify(created));
  console.log('\\nDemo data seeded. Admin session written. UIDs to clean:', created.length);
})().catch(e => { console.log('THROW:', e.message); process.exit(1); });
