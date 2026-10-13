// POST /api/event-signup - RSVP to a FREE event (no account needed).
// Body: { slug, name, email, phone?, guests? }
// One row per (event, email); signing up twice updates the same row, so a
// changed phone or guest count never double-counts. Confirmation email with a
// calendar file. Paid events go through /api/event-pay instead.
const { admin, safeError } = require('./_lib');
const { cleanSlug, publicEvent } = require('./event-status');

function str(v, max) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max); }
function toE164(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.charAt(0) === '+') return '+' + s.slice(1).replace(/[^\d]/g, '');
  const d = s.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!d) return null;
  return d.indexOf('971') === 0 ? '+' + d : '+971' + d;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  const slug = cleanSlug(body.slug);
  const name = str(body.name, 80);
  const email = str(body.email, 120).toLowerCase();
  const phone = toE164(body.phone);
  const guests = Math.max(0, Math.min(5, parseInt(body.guests, 10) || 0));
  if (!slug) return res.status(400).json({ error: 'Missing event' });
  if (!name) return res.status(400).json({ error: 'Your name, so we know who is coming.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A real email, the confirmation goes there.' });
  try {
    const db = admin();
    const ev = await publicEvent(db, slug);
    if (!ev || !ev.enabled) return res.status(404).json({ error: 'This event is not open.' });
    if (ev.past) return res.status(409).json({ error: 'This one has already happened.', past: true });
    if (ev.paid) return res.status(400).json({ error: 'This event is paid; use the booking on the page.', paid: true });

    const { data: existing } = await db.from('event_signups').select('id,guests,cancelled_at')
      .eq('event_slug', slug).eq('email', email).maybeSingle();
    const alreadyHolding = existing && !existing.cancelled_at ? 1 + Number(existing.guests || 0) : 0;
    const wanted = 1 + guests;
    if (ev.capacity != null && ev.taken - alreadyHolding + wanted > ev.capacity) {
      const left = Math.max(0, ev.capacity - (ev.taken - alreadyHolding));
      return res.status(409).json({ sold_out: left === 0, spots_left: left,
        error: left === 0 ? 'All places are taken.' : 'Only ' + left + (left === 1 ? ' place is' : ' places are') + ' left.' });
    }
    const { data: member } = await db.from('members').select('id').ilike('email', email).limit(1);
    const now = new Date().toISOString();
    const row = {
      event_slug: slug, member_id: member && member.length ? member[0].id : null,
      name, email, phone, guests, paid: false, source: 'online',
      cancelled_at: null, cancel_reason: null, updated_at: now
    };
    const { error } = await db.from('event_signups').upsert(row, { onConflict: 'event_slug,email' });
    if (error) throw error;

    try {
      const { sendEmail, emailShell, escapeHtml, buildIcs, formatDubaiDate } = require('./_email');
      const when = formatDubaiDate ? formatDubaiDate(ev.starts_at) : ev.starts_at;
      const first = escapeHtml(name.split(/\s+/)[0]);
      const bodyHtml = `
        <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">You&rsquo;re <span style="color:#999966;">on the list.</span></h1>
        <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">Hey ${first}, ${guests ? 'you and ' + guests + (guests === 1 ? ' friend are' : ' friends are') : 'you are'} down for ${escapeHtml(ev.title)}.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
          <tr><td style="padding:20px 22px;">
            <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">${escapeHtml(ev.title)}</div>
            <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:22px;letter-spacing:0.02em;color:#fff;">${escapeHtml(when)}</div>
            ${ev.location ? `<div style="margin-top:6px;color:rgba(255,255,255,0.65);font-size:14px;">${escapeHtml(ev.location)}${ev.map_url ? ` &middot; <a href="${escapeHtml(ev.map_url)}" style="color:#C9C9A8;">map</a>` : ''}</div>` : ''}
          </td></tr>
        </table>
        <p style="margin:22px 0 0;color:rgba(255,255,255,0.65);font-size:14px;line-height:1.55;">Calendar file attached. Plans change? Reply to this email and we take you off the list.</p>`;
      const durationMin = ev.ends_at ? Math.max(30, Math.round((new Date(ev.ends_at) - new Date(ev.starts_at)) / 60000)) : 120;
      const ics = buildIcs({ uid: 'event-' + slug + '-' + email, startDubaiIso: ev.starts_at, durationMinutes: durationMin,
        summary: ev.title, location: ev.location || '', description: (ev.tagline || '') });
      await sendEmail({
        to: email,
        subject: 'You’re on the list · ' + ev.title,
        html: emailShell({ preheader: ev.title + ' · ' + when, bodyHtml }),
        text: `Hey ${name.split(/\s+/)[0]}, you're on the list for ${ev.title} on ${when}${ev.location ? ' at ' + ev.location : ''}.`,
        attachments: [{ filename: 'lfg-' + slug + '.ics', content: Buffer.from(ics).toString('base64'), contentType: 'text/calendar' }]
      });
    } catch (mailErr) { console.warn('[event-signup] email failed:', mailErr && mailErr.message); }

    const fresh = await publicEvent(db, slug);
    return res.status(200).json({ ok: true, taken: fresh.taken, spots_left: fresh.spots_left, sold_out: fresh.sold_out });
  } catch (e) {
    return safeError(res, 'event-signup', e, 'Could not save your place. Try again.');
  }
};
