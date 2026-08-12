// Seeds a realistic demo dataset for the dashboard (kept until wiped).
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const lfg = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { db: { schema: 'lfg_dev' }, auth: { persistSession: false } });

async function member(name) {
  const email = 'lfgdemo_' + Math.random().toString(36).slice(2, 7) + '@example.com';
  const { data: c } = await admin.auth.admin.createUser({ email, password: 'Test!' + Math.random().toString(36).slice(2, 9), email_confirm: true, user_metadata: { full_name: name } });
  await lfg.from('members').upsert({ id: c.user.id, email, full_name: name });
  return c.user.id;
}

(async () => {
  const { data: sess } = await lfg.from('sessions').select('id,session_date').order('session_date');
  const exp = new Date(); exp.setMonth(exp.getMonth() + 2);
  const ex8 = new Date(); ex8.setMonth(ex8.getMonth() + 4);
  const ex12 = new Date(); ex12.setMonth(ex12.getMonth() + 5);

  async function pkg(uid, total, price, expires) {
    await lfg.from('member_packages').insert({ member_id: uid, sessions_total: total, sessions_remaining: total - 0, expires_at: expires.toISOString(), status: 'active' });
    await lfg.from('payments').insert({ member_id: uid, amount_aed: price, kind: 'package', status: 'paid', stripe_session_id: 'demo_' + uid });
  }
  async function book(uid, idx, sec, status) {
    await lfg.from('bookings').insert({ member_id: uid, session_id: sess[idx].id, section: sec, payment_type: 'credit', status: status || 'booked' });
  }

  // Sara — 8-pack, 2 bookings, 1 attended
  var sara = await member('Sara K'); await pkg(sara, 8, 658, ex8);
  await lfg.from('member_packages').update({ sessions_remaining: 6 }).eq('member_id', sara);
  await book(sara, 0, 'A', 'attended'); await book(sara, 1, 'A', 'booked');

  // Omar — 4-pack, 1 booking
  var omar = await member('Omar T'); await pkg(omar, 4, 368, exp);
  await lfg.from('member_packages').update({ sessions_remaining: 3 }).eq('member_id', omar);
  await book(omar, 0, 'B', 'booked');

  // Yousef — 12-pack, 1 booking
  var you = await member('Yousef A'); await pkg(you, 12, 906, ex12);
  await lfg.from('member_packages').update({ sessions_remaining: 11 }).eq('member_id', you);
  await book(you, 0, 'C', 'booked');

  // Lina — single, lapsed (booking 40 days ago)
  var lina = await member('Lina M');
  await lfg.from('payments').insert({ member_id: lina, amount_aed: 99, kind: 'single', status: 'paid', stripe_session_id: 'demo_' + lina });
  await book(lina, 1, 'B', 'attended');
  await lfg.from('bookings').update({ booked_at: new Date(Date.now() - 40 * 864e5).toISOString() }).eq('member_id', lina);

  console.log('Seeded 4 demo members (Sara, Omar, Yousef, Lina) with packages, payments, bookings.');
})().catch(e => { console.log('THROW:', e.message); process.exit(1); });
