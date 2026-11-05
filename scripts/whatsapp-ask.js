// Emails members with no WhatsApp number a personal link to /whatsapp (Loay, 5 Nov 2026:
// "prepare an email asking people to provide whatsapp number ... the link just forwards
// you to a page where u enter ur number"). Each recipient gets their own 30-day token in
// whatsapp_requests (sql/2026-11-05_whatsapp_requests.sql); api/whatsapp-number.js saves it.
//
//   node --env-file=<site env> scripts/whatsapp-ask.js --audience=sunday:2026-11-08
//   node --env-file=<site env> scripts/whatsapp-ask.js --audience=members
//     Dry run (default): counts the list, writes the first email to --preview=<file>, sends nothing.
//     It does copy run-club numbers onto member records, as the site does on their next visit.
//   ... --send            emails everyone on the list (one token each, ~2 a second)
//   ... --to=<email>      emails one member only (a test send to yourself)
//
// Audiences: sunday:<date> = booked (or attended) that Sunday; members = everyone who ever
// booked a bootcamp. Guests and anyone with a number (a run-club number counts and is
// copied across first) are left out.
const crypto = require('crypto');
const fs = require('fs');
const { admin, memberWhatsapp } = require('../api/_lib');
const { sendEmail, buildWhatsappAsk } = require('../api/_email');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const ORIGIN = 'https://www.lfgdubai.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function audience(db) {
  const a = String(args.audience || '');
  let rows = [];
  if (a.startsWith('sunday:')) {
    const { data: s } = await db.from('sessions').select('id,session_date,start_time,location,theme').eq('session_date', a.slice(7)).single();
    const { data: bk } = await db.from('bookings').select('member_id,section').eq('session_id', s.id).in('status', ['booked', 'attended']);
    rows = (bk || []).map((b) => ({ member_id: b.member_id, booking: { ...s, section: b.section } }));
  } else if (a === 'members') {
    const ids = new Set();
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('bookings').select('member_id').range(from, from + 999);
      (data || []).forEach((b) => ids.add(b.member_id));
      if (!data || data.length < 1000) break;
    }
    rows = [...ids].map((member_id) => ({ member_id }));
  } else throw new Error('--audience=sunday:<YYYY-MM-DD> or --audience=members');

  const out = [];
  for (let i = 0; i < rows.length; i += 200) {
    const { data: ms } = await db.from('members').select('id,email,full_name,is_guest').in('id', rows.slice(i, i + 200).map((r) => r.member_id));
    for (const m of ms || []) {
      if (m.is_guest || !m.email || /\.invalid$/i.test(m.email)) continue;
      if (args.to && m.email.toLowerCase() !== String(args.to).toLowerCase()) continue;
      if (await memberWhatsapp(db, { id: m.id, email: m.email })) continue;
      out.push({ ...m, booking: rows.find((r) => r.member_id === m.id).booking });
    }
  }
  return out;
}

function emailFor(m, link) {
  const b = m.booking;
  return buildWhatsappAsk({
    firstName: String(m.full_name || '').trim().split(/\s+/)[0] || '',
    link,
    booked: b ? {
      sessionDate: b.session_date,
      startTime: b.start_time,
      theme: b.theme || null,
      location: b.location || 'CrossFit Alioth',
      section: b.section || null
    } : null
  });
}

(async () => {
  const db = admin();
  const list = await audience(db);
  console.log(`${list.length} member(s) on the list (${args.send || args.to ? 'SENDING' : 'dry run, nothing sent'})`);
  if (!list.length) return;

  if (!args.send && !args.to) {
    const sample = emailFor(list[0], ORIGIN + '/whatsapp?t=' + '0'.repeat(64));
    if (args.preview) { fs.writeFileSync(args.preview, sample.html); console.log('preview written:', args.preview, '| subject:', sample.subject); }
    return;
  }

  let sent = 0, failed = 0;
  for (const m of list) {
    const token = crypto.randomBytes(32).toString('hex');
    const ins = await db.from('whatsapp_requests').insert({ token, member_id: m.id });
    if (ins.error) { failed++; console.warn('token failed for', m.id.slice(0, 8), ins.error.message); continue; }
    const mail = emailFor(m, ORIGIN + '/whatsapp?t=' + token);
    const r = await sendEmail({ to: m.email, subject: mail.subject, html: mail.html });
    if (r.ok) { sent++; await db.from('whatsapp_requests').update({ emailed_at: new Date().toISOString() }).eq('token', token); }
    else { failed++; console.warn('send failed for', m.id.slice(0, 8), r.error); }
    await sleep(550);
  }
  console.log(`sent ${sent}, failed ${failed}`);
})().catch((e) => { console.error(e); process.exit(1); });
