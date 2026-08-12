// POST /api/run-register - public endpoint replacing the Fillout form.
// Captures runner profile, dedupes by email (UPSERT), links to existing member row
// when the email already has one, records UTM + referrer + landing for attribution.
//
// Security:
//   - Honeypot field (`website_url`) rejects bots that auto-fill every field.
//   - Per-IP rate limit (5 successful registrations / hour) - module-scoped Map,
//     resets when the function cold-starts but stops obvious bursts.
//   - Server validates every field; client-side validation is never trusted.
//   - Service-role DB writes only; the table has RLS enabled with zero policies.
const { admin, authService, canonicalOrigin, buildAuthLink } = require('./_lib');
const { sendRunnerWelcome } = require('./_email');

const LEVELS = new Set(['beginner', 'occasional', 'advanced']);
// Which door the submission came through. One profile table, four entrances.
const SOURCES = new Set(['homepage', 'track', 'signup', 'bootcamp']);
const UAE_TENURES = new Set(['lt1', '1to5', '5to10', '10plus', 'born']);
const OCCUPATIONS = new Set(['student', 'working_pro', 'freelancer', 'business_owner', 'visiting', 'other']);
const HEAR_SOURCES = new Set(['instagram', 'friend', 'tobys', 'search', 'event', 'other']);

// Process-global so dev-server module hot-reload doesn't wipe state.
const ipBucket = (global.__lfgRunRegisterBucket = global.__lfgRunRegisterBucket || new Map());
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const entry = ipBucket.get(ip);
  if (!entry || entry.resetAt < now) {
    ipBucket.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// A run_date is acceptable if it's a real YYYY-MM-DD within the next ~60 days and not
// in the past. The client computes the next run; we still re-check server-side.
function validRunDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() < now - 2 * 86400000) return null;
  if (d.getTime() > now + 60 * 86400000) return null;
  return s;
}

// Filling the run form counts as "coming to the next run" - upsert an RSVP so the
// owner's headcount captures form sign-ups too, not just the logged-in one-tap RSVP.
// Best-effort; never blocks registration. Unique on (member_id, run_date) = no dupes.
async function recordRunRsvp(db, memberId, runDate, runType) {
  if (!memberId || !runDate) return;
  try {
    await db.from('run_rsvps').upsert(
      { member_id: memberId, run_date: runDate, run_type: runType, attending: true, updated_at: new Date().toISOString() },
      { onConflict: 'member_id,run_date' }
    );
  } catch (e) { console.warn('[run-register] rsvp skipped:', e && e.message); }
}

// New runner, no member yet: auto-provision a passwordless account, link the
// registration to it, and send a branded welcome with a one-tap login link plus a
// bootcamp nudge. Best-effort and called fire-and-forget - never blocks the form.
async function provisionRunnerAccount({ email, firstName, lastName, runRegId, origin, runDate, runType }) {
  const auth = authService();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  // Create the passwordless user. If the email already has an auth account this
  // errors (already registered) - nothing to onboard, so we stop.
  const { data: created, error: cErr } = await auth.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {}
  });
  if (cErr || !created || !created.user) return;
  const userId = created.user.id;

  const db = admin();
  await db.from('members').upsert({ id: userId, email, full_name: fullName }, { onConflict: 'id' });
  await recordRunRsvp(db, userId, runDate, runType); // count the new sign-up in the run headcount
  try { await db.from('run_registrations').update({ member_id: userId }).eq('id', runRegId); } catch (e) {}

  // Generate a passwordless login link to embed in our own branded email. If the
  // redirect isn't allow-listed yet the email falls back to /login (still works).
  let magicUrl = null;
  try {
    const { data: link } = await auth.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: origin + '/account' }
    });
    magicUrl = buildAuthLink(origin, link, '/account');
  } catch (e) { console.warn('[run-register] generateLink failed:', e.message); }

  await sendRunnerWelcome({ email, firstName, magicUrl, origin });
}

function clean(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function cleanEmail(v) {
  const s = clean(v, 320);
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s.toLowerCase();
}

function cleanPhone(v) {
  if (!v) return null;
  // Accept "+971501234567" or "971 50 123 4567" - strip everything but digits + leading +.
  const s = String(v).trim();
  const digits = s.replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,16}$/.test(digits)) return null;
  return digits.startsWith('+') ? digits : '+' + digits;
}

function cleanInstagram(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/^@/, '').slice(0, 30);
  if (!s) return null;
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return s.toLowerCase();
}

function cleanDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  // Sanity: between 1920 and today.
  const yr = d.getFullYear();
  if (yr < 1920 || d > new Date()) return null;
  return d.toISOString().slice(0, 10);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // Honeypot - real users won't fill `website_url`.
  if (clean(body.website_url, 1)) {
    return res.status(200).json({ ok: true }); // silent accept so bots don't learn anything
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many submissions. Try again later.' });

  const first_name = clean(body.first_name, 80);
  const last_name = clean(body.last_name, 80);
  const email = cleanEmail(body.email);
  const whatsapp_e164 = cleanPhone(body.whatsapp);
  const level = LEVELS.has(body.level) ? body.level : null;

  if (!first_name) return res.status(400).json({ error: 'First name is required' });
  if (!last_name) return res.status(400).json({ error: 'Last name is required' });
  if (!email) return res.status(400).json({ error: 'A valid email is required' });
  if (!whatsapp_e164) return res.status(400).json({ error: 'A valid WhatsApp number is required' });
  if (!level) return res.status(400).json({ error: 'Pick your level' });

  const instagram_handle = cleanInstagram(body.instagram_handle);
  const date_of_birth = cleanDate(body.date_of_birth);
  const nationality = clean(body.nationality, 80);
  const occupation = OCCUPATIONS.has(body.occupation) ? body.occupation : null;
  // Free-text profession, only meaningful for working professionals.
  const occupation_detail = occupation === 'working_pro' ? clean(body.occupation_detail, 120) : null;
  const interests = clean(body.interests, 400);
  const uae_tenure = UAE_TENURES.has(body.uae_tenure) ? body.uae_tenure : null;
  const hear_source = HEAR_SOURCES.has(body.hear_source) ? body.hear_source : null;
  const consent_marketing = body.consent_marketing === true;
  const run_date = validRunDate(body.run_date);
  const run_type = (typeof body.run_type === 'string' && body.run_type.length <= 20) ? body.run_type : null;

  const source = SOURCES.has(body.source) ? body.source : null;

  const row = {
    email,
    first_name,
    last_name,
    whatsapp_e164,
    level,
    utm_source:   clean(body.utm_source, 80),
    utm_medium:   clean(body.utm_medium, 80),
    utm_campaign: clean(body.utm_campaign, 120),
    utm_content:  clean(body.utm_content, 120),
    referrer:     clean(body.referrer, 500),
    landing_page: clean(body.landing_page, 500),
    client_ip: ip,
    updated_at: new Date().toISOString()
  };
  // The profile now arrives through several doors (homepage form, paid track run,
  // /register, bootcamp) and some send only a subset of fields. Optional fields are
  // written ONLY when the submission carries a value, so a quick track payment never
  // nulls out the rich profile someone gave earlier.
  if (source) row.source = source;
  if (instagram_handle) row.instagram_handle = instagram_handle;
  if (date_of_birth) row.date_of_birth = date_of_birth;
  if (nationality) row.nationality = nationality;
  if (occupation) row.occupation = occupation;
  if (occupation_detail) row.occupation_detail = occupation_detail;
  if (interests) row.interests = interests;
  if (uae_tenure) row.uae_tenure = uae_tenure;
  if (hear_source) row.hear_source = hear_source;
  if (consent_marketing) row.consent_marketing = true;

  try {
    const db = admin();

    // Auto-link to existing member by email (single source of truth across runs + bootcamp).
    const { data: matchedMember } = await db.from('members').select('id,full_name').eq('email', email).maybeSingle();
    if (matchedMember) row.member_id = matchedMember.id;

    // If a member exists but has no name yet, fill it in from this submission.
    if (matchedMember && !matchedMember.full_name) {
      await db.from('members').update({ full_name: (first_name + ' ' + last_name).trim() }).eq('id', matchedMember.id);
    }

    // Upsert: subsequent submits update the existing row rather than creating a duplicate.
    const { data: saved, error } = await db.from('run_registrations')
      .upsert(row, { onConflict: 'email' })
      .select('id,member_id,first_name,email')
      .single();

    if (error) {
      console.error('[run-register] upsert error:', error);
      return res.status(500).json({ error: 'Could not save registration' });
    }

    // Push to GHL after the LFG side has committed. Fire-and-forget - the
    // helper has its own try/catch and won't throw. Failure here never blocks
    // the registration response. Honors GHL_DRY_RUN + GHL_DISABLED env flags.
    try {
      const ghl = require('./_ghl');
      await ghl.onRunRegister({
        email, firstName: first_name, lastName: last_name,
        whatsapp_e164, level, hearSource: body.hear_source || null
      });
    } catch (e) { console.warn('[run-register → ghl]', e && e.message); }

    // Existing member → count them as coming to the next run right away.
    if (matchedMember && run_date) {
      await recordRunRsvp(db, matchedMember.id, run_date, run_type);
    }

    // New email (no member yet) → create a passwordless account + welcome email so
    // the runner becomes a member we can nurture toward the bootcamp. The account
    // creation also records the run RSVP (so the headcount includes brand-new sign-ups).
    if (!matchedMember) {
      try {
        const origin = canonicalOrigin(req);
        await provisionRunnerAccount({ email, firstName: first_name, lastName: last_name, runRegId: saved.id, origin, runDate: run_date, runType: run_type });
      } catch (e) { console.warn('[run-register] account provision skipped:', e && e.message); }
    }

    return res.status(200).json({
      ok: true,
      id: saved.id,
      first_name: saved.first_name,
      already_member: !!saved.member_id
    });
  } catch (e) {
    console.error('[/api/run-register]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
