// LFG email layer - Resend-backed transactional sends.
//
// Two public helpers:
//   - sendEmail({ to, subject, html, text?, attachments? })
//       Posts directly to Resend's REST API. Never throws - returns
//       { ok, id? , error? } so callers can fire-and-forget without
//       breaking the booking/credit flow when Resend is misconfigured.
//
//   - sendBookingConfirmation(db, { kind, member, sessionRow?, packageRow?, section?, creditsLeft? })
//       Composes the branded LFG confirmation email + .ics calendar
//       attachment (single sessions only - packages have no fixed date)
//       and dispatches it.
//
// Env vars expected:
//   RESEND_API_KEY     re_xxxxxxxxx (send-only restricted key is enough)
//   LFG_FROM_EMAIL     "LFG Dubai <bookings@lfgdubai.com>"  (or onboarding@resend.dev while testing)
//   LFG_OWNER_EMAIL    where the Friday roster goes (e.g. ahmed@lfgdubai.com)
//   LFG_REPLY_TO       optional; defaults to LFG_OWNER_EMAIL

// onboarding@resend.dev is Resend's SANDBOX sender: it can only deliver to the
// account owner's own address, so every customer email silently 403'd whenever
// LFG_FROM_EMAIL was unset (caught by the padel payment test, 2026-08-09).
// lfgdubai.com is a verified domain on the account, so default to it.
const DEFAULT_FROM = 'LFG Dubai <bookings@lfgdubai.com>';

async function sendEmail({ to, subject, html, text, attachments, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set - skipping send to', to);
    return { ok: false, error: 'RESEND_API_KEY missing' };
  }
  if (!to || !subject || !html) {
    return { ok: false, error: 'Missing required field (to/subject/html)' };
  }

  const body = {
    from: process.env.LFG_FROM_EMAIL || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(text ? { text } : {}),
    ...(replyTo || process.env.LFG_REPLY_TO ? { reply_to: replyTo || process.env.LFG_REPLY_TO } : {}),
    ...(attachments && attachments.length ? { attachments } : {})
  };

  // Bounded, but not hair-trigger. At 3s a normal Resend round trip to the
  // ap-northeast-1 region aborted mid-flight and the confirmation was lost
  // with only a log line (caught by the padel payment test, 2026-08-09).
  // Most of these sends run inside the Stripe webhook, where nobody is
  // waiting on the response.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Number(process.env.LFG_EMAIL_TIMEOUT_MS) || 8000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(t);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.warn('[email] Resend rejected:', res.status, data && data.message);
      return { ok: false, error: (data && data.message) || ('HTTP ' + res.status) };
    }
    return { ok: true, id: data && data.id };
  } catch (e) {
    clearTimeout(t);
    console.error('[email] send threw:', e.message);
    return { ok: false, error: e.message };
  }
}

// Build an RFC 5545 calendar invite. UID is stable per session+member so reopening
// the email doesn't create a duplicate calendar entry; updating SEQUENCE would let
// us push edits, but we don't need that today.
function buildIcs({ uid, startDubaiIso, durationMinutes, summary, location, description }) {
  // Convert Dubai-local ISO to UTC for the .ics DTSTART. Dubai is UTC+4 year-round.
  const startUtc = new Date(startDubaiIso);
  const endUtc = new Date(startUtc.getTime() + (durationMinutes || 60) * 60000);
  const fmt = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const escape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LFG Dubai//Bootcamp//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(startUtc),
    'DTEND:' + fmt(endUtc),
    'SUMMARY:' + escape(summary),
    'LOCATION:' + escape(location),
    'DESCRIPTION:' + escape(description),
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + escape(summary + ' starts in 1 hour'),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// Shared chrome - used by every transactional email.
function emailShell({ preheader, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>LFG Dubai</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;color:#fff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader || '')}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0A0A;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#111;border:1px solid rgba(153,153,102,0.3);">
        <tr><td style="padding:32px 32px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:28px;letter-spacing:0.12em;color:#fff;text-transform:uppercase;">LFG<span style="color:#999966;"> · </span><span style="color:#999966;font-weight:600;">Dubai</span></div>
        </td></tr>
        <tr><td style="padding:28px 32px 32px;">${bodyHtml}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function formatDubaiDate(iso) {
  // iso here is YYYY-MM-DD (session_date column). Render as "Sunday, 31 May".
  const d = new Date(iso + 'T12:30:00+04:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' });
}

// Turn a 'HH:MM:SS' session start_time into a friendly '12:45 PM'. Falls back to the
// historical default if the session has no start_time. Source of truth is the Schedule tab.
function formatTime12(startTime) {
  if (!startTime) return '12:30 PM';
  const parts = String(startTime).split(':');
  let h = parseInt(parts[0], 10);
  const m = (parts[1] || '00').padStart(2, '0');
  if (isNaN(h)) return '12:30 PM';
  const ap = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + m + ' ' + ap;
}

// Build the booking-confirmation email for a single Sunday bootcamp.
function buildSingleConfirmation({ firstName, sessionDate, section, location, paidAmount, creditsLeft, timeLabel }) {
  const niceDate = formatDubaiDate(sessionDate);
  const when = timeLabel || '12:30 PM';
  const preheader = "You're booked for " + niceDate + ' at ' + when + '.';
  const greeting = firstName ? 'Hey ' + escapeHtml(firstName) + ',' : 'Hey,';
  const paidLine = paidAmount > 0
    ? '<div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,0.55);">Paid AED ' + escapeHtml(String(paidAmount)) + '</div>'
    : (typeof creditsLeft === 'number'
        ? '<div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,0.55);">Used 1 credit · ' + creditsLeft + ' remaining</div>'
        : '');

  const body = `
    <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">You're <span style="color:#999966;">in.</span></h1>
    <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">${greeting}<br>See you on the turf.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);padding:0;">
      <tr><td style="padding:18px 20px;">
        <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">Your session</div>
        <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:24px;letter-spacing:0.02em;color:#fff;line-height:1.1;">${escapeHtml(niceDate)} · ${escapeHtml(when)}</div>
        <div style="margin-top:10px;color:rgba(255,255,255,0.7);font-size:14px;">${escapeHtml(location || 'CrossFit Alioth')}${section ? ' · Station <b style="color:#999966;">' + escapeHtml(section) + '</b>' : ''}</div>
        ${paidLine}
      </td></tr>
    </table>
    <p style="margin:22px 0 8px;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">We attached a calendar invite. Tap it to drop the session straight into your phone calendar.</p>
    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">Need to cancel? You can free your spot from <a href="https://www.lfgdubai.com/account" style="color:#999966;text-decoration:underline;">My Account</a> any time up to 8:00 AM Dubai time on session day, and your credit goes straight back.</p>
  `;
  return emailShell({ preheader, bodyHtml: body });
}

function buildPackageConfirmation({ firstName, packageName, sessionsCount, paidAmount, expiresAtIso }) {
  const expires = new Date(expiresAtIso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const preheader = sessionsCount + ' bootcamp credits added to your account.';
  const greeting = firstName ? 'Hey ' + escapeHtml(firstName) + ',' : 'Hey,';
  const body = `
    <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">Credits <span style="color:#999966;">loaded.</span></h1>
    <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">${greeting}<br>Your pack is ready to use.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
      <tr><td style="padding:18px 20px;">
        <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">Your pack</div>
        <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:700;font-size:24px;letter-spacing:0.02em;color:#fff;line-height:1.1;">${sessionsCount} credits · ${escapeHtml(packageName || 'LFG Pack')}</div>
        <div style="margin-top:10px;color:rgba(255,255,255,0.7);font-size:14px;">Paid AED ${escapeHtml(String(paidAmount))} · Valid until <b style="color:#999966;">${escapeHtml(expires)}</b></div>
      </td></tr>
    </table>
    <p style="margin:22px 0 0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">Lock in your Sundays from <a href="https://www.lfgdubai.com/bootcamp.html#bootcamps" style="color:#999966;text-decoration:underline;">the booking page</a> - each booking spends one credit.</p>
  `;
  return emailShell({ preheader, bodyHtml: body });
}

// Top-level entry point called from fulfillCheckoutSession after the booking/credit lands.
async function sendBookingConfirmation(db, args) {
  const { kind, memberId } = args;
  try {
    const { data: member } = await db.from('members').select('email,full_name').eq('id', memberId).maybeSingle();
    if (!member || !member.email) {
      console.warn('[email] no email on member ' + memberId + ' - skipping confirmation');
      return { ok: false, error: 'no member email' };
    }
    const firstName = (member.full_name || '').split(/\s+/)[0] || null;

    if (kind === 'single') {
      const { sessionDate, section, location, paidAmount, sessionId } = args;
      // Read the session's real start time (set from the Schedule tab) so the email,
      // its time line, and the calendar invite all reflect whatever the owner configured.
      let startTime = null;
      try {
        const { data: sess } = await db.from('sessions').select('start_time').eq('id', sessionId).maybeSingle();
        startTime = sess && sess.start_time ? sess.start_time : null;
      } catch (e) { /* fall back to default below */ }
      const timeLabel = formatTime12(startTime);
      const html = buildSingleConfirmation({ firstName, sessionDate, section, location, paidAmount, timeLabel });
      const ics = buildIcs({
        uid: 'lfg-' + sessionId + '-' + memberId + '@lfgdubai.com',
        startDubaiIso: sessionDate + 'T' + (startTime || '12:30:00') + '+04:00',
        durationMinutes: 60,
        summary: 'LFG Sunday Bootcamp',
        location: location || 'CrossFit Alioth, Dubai',
        description: 'Station ' + (section || 'TBD') + ' - ' + (location || 'CrossFit Alioth, Dubai')
      });
      return sendEmail({
        to: member.email,
        subject: "You're in · LFG Sunday Bootcamp · " + formatDubaiDate(sessionDate),
        html,
        attachments: [{
          filename: 'lfg-sunday.ics',
          content: Buffer.from(ics, 'utf-8').toString('base64'),
          content_type: 'text/calendar; method=PUBLISH; charset=utf-8'
        }]
      });
    }

    if (kind === 'package') {
      const { packageName, sessionsCount, paidAmount, expiresAtIso } = args;
      const html = buildPackageConfirmation({ firstName, packageName, sessionsCount, paidAmount, expiresAtIso });
      return sendEmail({
        to: member.email,
        subject: sessionsCount + ' bootcamp credits loaded · LFG Dubai',
        html
      });
    }

    return { ok: false, error: 'unknown kind ' + kind };
  } catch (e) {
    console.error('[email] sendBookingConfirmation threw:', e.message);
    return { ok: false, error: e.message };
  }
}

// Welcome email for a runner who just filled the registration form. We auto-create
// a passwordless account for them; this hands over a one-tap login link and nudges
// them toward the paid Sunday bootcamp (the conversion the whole flow exists for).
function buildRunnerWelcome({ firstName, magicUrl, origin }) {
  const base = origin || 'https://www.lfgdubai.com';
  const loginHref = magicUrl || (base + '/login');
  const loginLabel = magicUrl ? 'Open my account' : 'Log in';
  const greeting = firstName ? 'Hey ' + escapeHtml(firstName) + ',' : 'Hey,';
  const body = `
    <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">You're <span style="color:#999966;">in.</span></h1>
    <p style="margin:0 0 20px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">${greeting}<br>Your LFG account is ready. Track your runs and streak, and book Sunday bootcamp from one place. No password - just tap below.</p>
    <a href="${escapeHtml(loginHref)}" style="display:inline-block;background:#999966;color:#0A0A0A;font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:14px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;">${loginLabel}</a>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
      <tr><td style="padding:18px 20px;">
        <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-size:11px;letter-spacing:0.26em;text-transform:uppercase;color:#999966;margin-bottom:6px;">Try this next</div>
        <div style="color:rgba(255,255,255,0.8);font-size:14px;line-height:1.5;margin-bottom:8px;">Sunday Bootcamp. 60 minutes, scaled to every level. The fastest way to feel the difference.</div>
        <a href="${escapeHtml(base + '/bootcamp.html#bootcamps')}" style="color:#999966;text-decoration:underline;font-size:14px;">Reserve a Sunday &rarr;</a>
      </td></tr>
    </table>
    <p style="margin:22px 0 0;font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">You're getting this because you signed up at lfgdubai.com. Your login link is personal to you, so keep it to yourself.</p>
  `;
  return emailShell({ preheader: 'Your LFG account is ready - tap to open it.', bodyHtml: body });
}

async function sendRunnerWelcome({ email, firstName, magicUrl, origin }) {
  if (!email) return { ok: false, error: 'no email' };
  return sendEmail({
    to: email,
    subject: "You're in - your LFG account is ready",
    html: buildRunnerWelcome({ firstName, magicUrl, origin })
  });
}

// Branded login-link email. Replaces Supabase's default magic-link email so the
// sign-in email is on-brand and comes from our own verified domain, not pm-bounces.
function buildLoginLinkEmail({ magicUrl, code }) {
  // When present, the 6-digit code lets people using the phone app (PWA) sign in
  // WITHOUT leaving the app - they type the code back in. The link stays for
  // desktop / one-tap. On iOS a tapped link always opens Safari, not the installed
  // app, so the code is the only way an app user keeps their session.
  const codeBlock = code ? `
    <p style="margin:0 0 10px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">Using the app on your phone? Enter this code to sign in:</p>
    <div style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:34px;letter-spacing:0.32em;color:#999966;background:rgba(153,153,102,0.10);border:1px solid rgba(153,153,102,0.35);padding:16px 10px;text-align:center;margin:0 0 22px;">${escapeHtml(String(code))}</div>
    <p style="margin:0 0 22px;color:rgba(255,255,255,0.45);font-size:13px;line-height:1.55;">Or, on a computer, tap the button below.</p>
  ` : `
    <p style="margin:0 0 22px;color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;">Tap below to open your LFG account. This link is personal to you and signs you straight in. No password needed.</p>
  `;
  const body = `
    <h1 style="font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;color:#fff;">Sign <span style="color:#999966;">in.</span></h1>
    ${codeBlock}
    <a href="${escapeHtml(magicUrl)}" style="display:inline-block;background:#999966;color:#0A0A0A;font-family:'Barlow Condensed','Helvetica Neue',sans-serif;font-weight:800;font-size:14px;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 30px;">Log in to LFG</a>
    <p style="margin:24px 0 0;font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">For your security this ${code ? 'code and link expire' : 'link expires'} after a short while. If you didn't ask to sign in, you can safely ignore this email.</p>
  `;
  return emailShell({ preheader: code ? 'Your LFG sign-in code (or tap to log in).' : 'Your LFG sign-in link - tap to log in.', bodyHtml: body });
}

async function sendLoginLink({ email, magicUrl, code }) {
  if (!email || !magicUrl) return { ok: false, error: 'missing email or link' };
  return sendEmail({
    to: email,
    subject: code ? `Your LFG login code: ${code}` : 'Your LFG login link',
    html: buildLoginLinkEmail({ magicUrl, code })
  });
}

module.exports = { sendEmail, buildIcs, sendBookingConfirmation, buildSingleConfirmation, buildPackageConfirmation, buildRunnerWelcome, sendRunnerWelcome, buildLoginLinkEmail, sendLoginLink, emailShell, formatDubaiDate, escapeHtml };
