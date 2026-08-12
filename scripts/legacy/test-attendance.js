// Attendance/roster test + seed for screenshot. Writes admin session to tmp.
const fs = require('fs'), os = require('os'), path = require('path');
const { createClient } = require('@supabase/supabase-js');
const URL = process.env.SUPABASE_URL, SERVICE = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
const lfg = createClient(URL, SERVICE, { db: { schema: 'lfg_dev' }, auth: { persistSession: false } });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

async function mkUser(name, isAdmin) {
  const email = (isAdmin ? 'lfgadmin_' : 'lfgdemo_') + Math.random().toString(36).slice(2, 8) + '@example.com';
  const password = 'Test!' + Math.random().toString(36).slice(2, 10);
  const { data: c } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  await lfg.from('members').upsert({ id: c.user.id, email, full_name: name, is_admin: !!isAdmin });
  const { data } = await anon.auth.signInWithPassword({ email, password });
  return { uid: c.user.id, email, token: data.session.access_token, session: data.session };
}
const api = (p, token, method, body) => fetch('http://localhost:8080' + p, {
  method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, { Authorization: 'Bearer ' + token }),
  body: body ? JSON.stringify(body) : undefined
});

(async () => {
  const adminU = await mkUser('Owner View', true);
  const m1 = await mkUser('Sara K'), m2 = await mkUser('Omar T'), m3 = await mkUser('Lina M');
  const { data: sess } = await lfg.from('sessions').select('id,session_date').order('session_date');
  const target = sess[1]; // Sun 7 Jun

  await lfg.from('bookings').insert([
    { member_id: m1.uid, session_id: target.id, section: 'A', payment_type: 'credit', status: 'booked' },
    { member_id: m2.uid, session_id: target.id, section: 'A', payment_type: 'credit', status: 'booked' },
    { member_id: m3.uid, session_id: target.id, section: 'B', payment_type: 'single', status: 'booked' }
  ]);

  const r1 = await api('/api/admin/roster?session_id=' + target.id, adminU.token);
  const roster = await r1.json();
  console.log('roster HTTP', r1.status, '| attendees:', roster.attendees.length, '| sections:', roster.attendees.map(a => a.section).join(','));

  const bk = roster.attendees[0];
  const r2 = await api('/api/admin/mark-attendance', adminU.token, 'POST', { booking_id: bk.booking_id, status: 'attended' });
  console.log('mark attended HTTP', r2.status, JSON.stringify(await r2.json()));

  const r3 = await api('/api/admin/roster?session_id=' + target.id, adminU.token);
  const after = (await r3.json()).attendees.find(a => a.booking_id === bk.booking_id);
  console.log('roster after -> that booking status:', after.status, after.status === 'attended' ? '✓' : '✗');

  const st = await (await api('/api/admin/stats', adminU.token)).json();
  console.log('dashboard attended total:', st.totals.attended);

  fs.writeFileSync(path.join(os.tmpdir(), 'lfg-sess.json'), JSON.stringify(adminU.session));
  console.log('TARGET_SESSION=' + target.id);
  console.log('seeded; admin session written for screenshot');
})().catch(e => { console.log('THROW:', e.message); process.exit(1); });
