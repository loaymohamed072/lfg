// POST /api/admin/send-roster - builds the next Sunday's roster and emails it
// to LFG_OWNER_EMAIL. Two auth paths:
//
//   1. Bearer Supabase JWT (admin user clicking "Send roster now" in admin)
//   2. Bearer LFG_CRON_TOKEN (GitHub Actions / Vercel Cron / any scheduler)
//
// Body: { session_id?, target_email? }
//   session_id    - explicit session UUID to roster; defaults to the next upcoming Sunday
//   target_email  - override recipient; defaults to LFG_OWNER_EMAIL
//
// GET also supported for dry-run inspection (returns the roster JSON, no email).
const { admin, getUser, isAdmin, formatDate, safeError } = require('../_lib');
const { sendEmail, emailShell, escapeHtml } = require('../_email');

function stationLabels(n) { const o = []; for (let i = 0; i < (n || 4); i++) o.push(String.fromCharCode(65 + i)); return o; }

async function authorise(req, db) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { ok: false, status: 401, error: 'Not authenticated' };

  // Path A: cron token match (custom token OR Vercel Cron's CRON_SECRET bearer)
  if (process.env.LFG_CRON_TOKEN && token === process.env.LFG_CRON_TOKEN) {
    return { ok: true, mode: 'cron' };
  }
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
    return { ok: true, mode: 'cron' };
  }

  // Path B: Supabase admin user
  const user = await getUser(req);
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' };
  if (!(await isAdmin(db, user.id))) return { ok: false, status: 403, error: 'Admins only' };
  return { ok: true, mode: 'admin', user };
}

async function pickNextSession(db, explicitId) {
  if (explicitId) {
    const { data } = await db.from('sessions').select('id,session_date,start_time,location,capacity,status,stations').eq('id', explicitId).maybeSingle();
    return data;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db.from('sessions').select('id,session_date,start_time,location,capacity,status')
    .gte('session_date', today)
    .eq('status', 'open')
    .order('session_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

async function buildRoster(db, session) {
  const { data: bookings } = await db.from('bookings')
    .select('id,section,status,booked_at,member:members(full_name,email,whatsapp_e164)')
    .eq('session_id', session.id)
    .in('status', ['booked', 'attended'])
    .order('booked_at', { ascending: true });

  const n = session.stations || 4;
  const labels = stationLabels(n);
  const bySection = { unassigned: [] };
  labels.forEach(l => { bySection[l] = []; });
  (bookings || []).forEach(b => {
    const key = labels.includes(b.section) ? b.section : 'unassigned';
    const m = b.member || {};
    bySection[key].push({
      name: m.full_name || (m.email ? m.email.split('@')[0] : 'Unknown'),
      email: m.email || null,
      status: b.status
    });
  });

  return {
    session_id: session.id,
    date: session.session_date,
    date_label: formatDate(session.session_date, session.start_time),
    location: session.location,
    capacity: session.capacity,
    stations: n,
    total: (bookings || []).length,
    sections: bySection
  };
}

function rosterHtml(roster) {
  const headerLabel = roster.date_label;
  const sectionBlock = (label, list) => {
    const filledRows = list.map(p => `<li style="margin:0;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px;">${escapeHtml(p.name)}${p.email ? ' <span style="color:rgba(255,255,255,0.4);font-size:12px;">· ' + escapeHtml(p.email) + '</span>' : ''}</li>`).join('');
    return `<div style="margin-top:18px;">
      <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:8px;">Station ${escapeHtml(label)} · ${list.length}</div>
      ${list.length ? '<ul style="list-style:none;padding:0;margin:0;">' + filledRows + '</ul>' : '<div style="color:rgba(255,255,255,0.4);font-size:13px;font-style:italic;">empty</div>'}
    </div>`;
  };
  const labels = stationLabels(roster.stations || 4);

  const body = `
    <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">${escapeHtml(headerLabel)}</h1>
    <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">${escapeHtml(roster.location || 'CrossFit Alioth')} · ${roster.total} of ${roster.capacity} booked</p>
    ${labels.map(s => sectionBlock(s, roster.sections[s] || [])).join('')}
    ${roster.sections.unassigned.length ? sectionBlock('Unassigned', roster.sections.unassigned) : ''}
    <p style="margin:28px 0 0;font-size:12px;color:rgba(255,255,255,0.35);line-height:1.6;">Print this, or open it on your phone at the session. Mark attendance afterwards from <a href="https://www.lfgdubai.com/admin" style="color:#999966;text-decoration:underline;">admin</a>.</p>
  `;
  return emailShell({ preheader: `${roster.total} booked for ${headerLabel}`, bodyHtml: body });
}

module.exports = async (req, res) => {
  const db = admin();
  const auth = await authorise(req, db);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const body = (req.method === 'POST' && req.body) || {};
    const session = await pickNextSession(db, body.session_id);
    if (!session) return res.status(404).json({ error: 'No upcoming session found' });
    const roster = await buildRoster(db, session);

    if (req.method === 'GET') {
      return res.status(200).json({ roster });
    }

    const to = body.target_email || process.env.LFG_OWNER_EMAIL;
    if (!to) return res.status(400).json({ error: 'No target email - set LFG_OWNER_EMAIL or pass target_email' });

    const html = rosterHtml(roster);
    const send = await sendEmail({
      to,
      subject: 'Sunday roster · ' + roster.date_label + ' · ' + roster.total + ' of ' + roster.capacity + ' booked',
      html
    });

    if (!send.ok) return res.status(502).json({ ok: false, error: send.error, roster });
    return res.status(200).json({ ok: true, sent_to: to, message_id: send.id, roster: { total: roster.total, capacity: roster.capacity, date: roster.date } });
  } catch (e) {
    return safeError(res, '/api/admin/send-roster', e, 'Roster send failed');
  }
};
