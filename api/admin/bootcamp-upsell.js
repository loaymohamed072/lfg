// /api/admin/bootcamp-upsell - the pack nudge for people who keep showing up.
//
// Omar's idea (30 Sep 2026): someone who has done four Sundays in a row on
// single tickets is the likeliest person to buy a pack, and nobody was telling
// them. Vercel Cron runs this Monday morning Dubai time, after Sunday's
// check-ins are in; an admin can also call it by hand.
//
// Who gets it: attended ALL of the last four sessions, holds no live credit
// pack, and has not had this nudge in the last 28 days. Email always (every
// member has one; booking confirmations already go there), web push as well
// for the few who allowed it. One row in bootcamp_upsell_nudges per send, so
// the same person is never nudged every Monday.
//
// ?dry=1 lists who WOULD get it and sends nothing.
const { admin, requireAdminOrCron, safeError } = require('../_lib');
const { sendToMembers } = require('../_push');
const { sendEmail, emailShell, escapeHtml } = require('../_email');

const STREAK = 4;
const COOLDOWN_DAYS = 28;
const MAX_PER_RUN = 50;
const SITE = 'https://www.lfgdubai.com';
const PACKS_URL = SITE + '/bootcamp.html#bootcamps';

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` (same check as
// push-dispatch; requireAdminOrCron only knows LFG_CRON_TOKEN).
function isVercelCron(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return Boolean(token && process.env.CRON_SECRET && token === process.env.CRON_SECRET);
}

function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

// Members who attended every one of the last STREAK sessions, hold no live
// pack, and were not nudged inside the cooldown.
async function candidates(db) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: sessions, error: sErr } = await db.from('sessions')
    .select('id, session_date')
    .lte('session_date', today)
    .order('session_date', { ascending: false })
    .limit(STREAK);
  if (sErr) throw sErr;
  if (!sessions || sessions.length < STREAK) return { sessions: [], people: [] };

  const ids = sessions.map(s => s.id);
  const { data: rows, error: bErr } = await db.from('bookings')
    .select('member_id, session_id')
    .eq('status', 'attended')
    .in('session_id', ids);
  if (bErr) throw bErr;

  const bySess = new Map();
  (rows || []).forEach(r => {
    if (!bySess.has(r.member_id)) bySess.set(r.member_id, new Set());
    bySess.get(r.member_id).add(r.session_id);
  });
  const streakers = [...bySess.entries()].filter(([, set]) => set.size === STREAK).map(([m]) => m);
  if (!streakers.length) return { sessions, people: [] };

  const nowIso = new Date().toISOString();
  const [{ data: packs }, { data: recent }] = await Promise.all([
    db.from('member_packages').select('member_id')
      .in('member_id', streakers).eq('status', 'active')
      .gt('sessions_remaining', 0).gt('expires_at', nowIso),
    db.from('bootcamp_upsell_nudges').select('member_id')
      .in('member_id', streakers)
      .gte('sent_at', new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString())
  ]);
  const packed = new Set((packs || []).map(p => p.member_id));
  const nudged = new Set((recent || []).map(n => n.member_id));

  const eligible = streakers.filter(m => !packed.has(m) && !nudged.has(m)).slice(0, MAX_PER_RUN);
  if (!eligible.length) return { sessions, people: [] };
  const { data: members } = await db.from('members').select('id, full_name, email').in('id', eligible);
  return { sessions, people: (members || []).filter(m => m.email) };
}

// Same voice as the booking emails: short, specific, the number that matters.
function buildNudgeEmail({ first, singlePrice, pack }) {
  const per = Math.round(pack.price_aed / pack.sessions_count);
  const greeting = first ? 'Hey ' + escapeHtml(first) + ',' : 'Hey,';
  const preheader = 'Four Sundays in a row. The ' + pack.sessions_count + '-credit pack makes each one AED ' + per + '.';
  const body = `
    <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">Four Sundays <span style="color:#999966;">straight.</span></h1>
    <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">${greeting}<br>That's a habit now. You've been paying for it one Sunday at a time.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
      <tr><td style="padding:18px 20px;">
        <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">The ${pack.sessions_count}-credit pack</div>
        <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:24px;letter-spacing:0.02em;color:#fff;line-height:1.1;">AED ${per} a session</div>
        <div style="margin-top:10px;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;">Instead of AED ${escapeHtml(String(singlePrice))}. AED ${escapeHtml(String(pack.price_aed))} for ${pack.sessions_count} Sundays, valid ${pack.validity_months} month${pack.validity_months === 1 ? '' : 's'}. Packs don't expire mid-cycle, so life can happen.</div>
      </td></tr>
    </table>
    <p style="margin:22px 0 0;">
      <a href="${PACKS_URL}" style="display:inline-block;background:#999966;color:#0A0A0A;font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:14px;letter-spacing:0.14em;text-transform:uppercase;text-decoration:none;padding:12px 18px;">See the packs</a>
    </p>
    <p style="margin:22px 0 0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">Prefer paying as you go? That works too. A single session stays AED ${escapeHtml(String(singlePrice))}.</p>
  `;
  const text = [
    greeting,
    '',
    'Four Sundays straight. That\'s a habit now, and you\'ve been paying for it one Sunday at a time.',
    '',
    'The ' + pack.sessions_count + '-credit pack makes each session AED ' + per + ' instead of ' + singlePrice + ' (AED ' + pack.price_aed + ' for ' + pack.sessions_count + ' Sundays, valid ' + pack.validity_months + ' months). Packs don\'t expire mid-cycle, so life can happen.',
    '',
    'See the packs: ' + PACKS_URL,
    '',
    'Prefer paying as you go? That works too. A single session stays AED ' + singlePrice + '.'
  ].join('\n');
  return { subject: 'Four Sundays straight', html: emailShell({ preheader, bodyHtml: body }), text };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const ctx = isVercelCron(req) ? { db: admin(), mode: 'cron' } : await requireAdminOrCron(req, res);
  if (!ctx) return;
  const { db } = ctx;
  const dry = String((req.query && req.query.dry) || '') === '1';

  try {
    const [{ sessions, people }, { data: pkgs }] = await Promise.all([
      candidates(db),
      db.from('packages').select('id, name, sessions_count, price_aed, validity_months')
        .eq('active', true).order('sessions_count', { ascending: true })
    ]);
    // The 8-credit pack is the one the site pushes ("Most popular"); fall back
    // to the biggest if it is ever taken off sale.
    const list = pkgs || [];
    const pack = list.find(p => p.sessions_count === 8) || list[list.length - 1] || null;
    const singlePrice = Number(process.env.SINGLE_SESSION_PRICE_AED || 99);
    const window = sessions.map(s => s.session_date);

    if (dry || !pack || !people.length) {
      return res.status(200).json({
        ok: true, dry: dry || !pack, sessions: window, pack: pack ? pack.name : null,
        candidates: people.map(p => ({ id: p.id, name: p.full_name }))
      });
    }

    const per = Math.round(pack.price_aed / pack.sessions_count);
    const pushed = await sendToMembers(db, people.map(p => p.id), {
      title: 'Four Sundays straight',
      body: 'The ' + pack.sessions_count + '-credit pack makes each one AED ' + per + ' instead of ' + singlePrice + '. Packs don\'t expire mid-cycle.',
      url: '/bootcamp.html#bootcamps',
      tag: 'lfg-pack-nudge'
    });
    const reached = new Set(pushed.members || []);

    const results = [];
    for (const p of people) {
      const mail = buildNudgeEmail({ first: firstName(p.full_name), singlePrice, pack });
      const r = await sendEmail({ to: p.email, subject: mail.subject, html: mail.html, text: mail.text });
      const channels = [];
      if (r.ok) channels.push('email');
      if (reached.has(p.id)) channels.push('push');
      if (channels.length) {
        await db.from('bootcamp_upsell_nudges').insert({ member_id: p.id, streak: STREAK, channels });
      }
      results.push({ id: p.id, name: p.full_name, channels, email_error: r.ok ? null : r.error });
    }

    return res.status(200).json({
      ok: true, sessions: window, pack: pack.name,
      sent: results.filter(r => r.channels.length).length,
      push: { sent: pushed.sent, failed: pushed.failed, skipped: pushed.skipped },
      results
    });
  } catch (e) {
    return safeError(res, '/api/admin/bootcamp-upsell', e, 'Nudge run failed');
  }
};
