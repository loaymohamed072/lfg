// GET /api/run-profile - for the logged-in member, reports whether their run sign-up
// details are complete, and returns what we have for pre-filling the form. Google /
// magic-link sign-ups never fill the run form, so we keep the form in front of them
// (instead of the RSVP buttons) until these fields exist.
//
// POST /api/run-profile - saves ONLY the two contact fields the owner chases people on
// (WhatsApp + Instagram). First-timers who walk in and check in with a fresh account
// have neither on file, so the check-in success screen asks for them there and then.
const { admin, getUser } = require('./_lib');

// Fields a complete run profile must have (mirrors the public sign-up form's requirements).
const REQUIRED = ['first_name', 'last_name', 'whatsapp_e164', 'level', 'date_of_birth', 'nationality', 'uae_tenure', 'occupation'];
const SELECT = 'first_name,last_name,email,whatsapp_e164,level,date_of_birth,nationality,uae_tenure,occupation,occupation_detail,instagram_handle,created_at';

// Same shapes api/run-register.js stores, so both entry points write identical data.
function cleanPhone(v) {
  if (!v) return null;
  const s = String(v).trim();
  const digits = s.replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,16}$/.test(digits)) return null;
  return digits.startsWith('+') ? digits : '+' + digits;
}

function cleanInstagram(v) {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/^instagram\.com\//i, '');
  s = s.replace(/[\/?#].*$/, '').replace(/^@/, '').slice(0, 30);
  if (!s) return null;
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return s.toLowerCase();
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return getProfile(req, res);
  if (req.method === 'POST') return saveContact(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};

async function getProfile(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const db = admin();
    // Prefer a registration linked to this member; fall back to one matching their email.
    let reg = null;
    const r1 = await db.from('run_registrations').select(SELECT)
      .eq('member_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    reg = r1.data || null;
    if (!reg && user.email) {
      const r2 = await db.from('run_registrations').select(SELECT)
        .eq('email', user.email.toLowerCase()).order('created_at', { ascending: false }).limit(1).maybeSingle();
      reg = r2.data || null;
    }

    const complete = !!reg && REQUIRED.every(f => reg[f] != null && String(reg[f]).trim() !== '');

    // Name/email fallback from the Google/auth profile so we can pre-fill the form.
    const meta = user.user_metadata || {};
    const fullName = String(meta.full_name || meta.name || '').trim();
    const firstFromName = fullName.split(/\s+/)[0] || '';
    const lastFromName = fullName.split(/\s+/).slice(1).join(' ') || '';

    return res.status(200).json({
      complete,
      profile: {
        first_name: (reg && reg.first_name) || firstFromName,
        last_name: (reg && reg.last_name) || lastFromName,
        email: (reg && reg.email) || user.email || '',
        whatsapp: (reg && reg.whatsapp_e164) || '',
        level: (reg && reg.level) || '',
        date_of_birth: (reg && reg.date_of_birth) || '',
        nationality: (reg && reg.nationality) || '',
        uae_tenure: (reg && reg.uae_tenure) || '',
        occupation: (reg && reg.occupation) || '',
        occupation_detail: (reg && reg.occupation_detail) || '',
        instagram_handle: (reg && reg.instagram_handle) || ''
      }
    });
  } catch (e) {
    console.error('[/api/run-profile]', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

// Body: { whatsapp?, instagram_handle? } - send only the fields you are filling in.
// Writes onto the member's most recent run_registrations row, or creates a minimal
// row when they have never filled the run form (walk-in accounts).
async function saveContact(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  const sentPhone = body.whatsapp != null && String(body.whatsapp).trim() !== '';
  const sentIg = body.instagram_handle != null && String(body.instagram_handle).trim() !== '';
  const whatsapp_e164 = sentPhone ? cleanPhone(body.whatsapp) : null;
  const instagram_handle = sentIg ? cleanInstagram(body.instagram_handle) : null;

  if (sentPhone && !whatsapp_e164) return res.status(400).json({ error: 'That WhatsApp number does not look right' });
  if (sentIg && !instagram_handle) return res.status(400).json({ error: 'That Instagram handle does not look right' });
  if (!whatsapp_e164 && !instagram_handle) return res.status(400).json({ error: 'Nothing to save' });

  const patch = { updated_at: new Date().toISOString() };
  if (whatsapp_e164) patch.whatsapp_e164 = whatsapp_e164;
  if (instagram_handle) patch.instagram_handle = instagram_handle;

  try {
    const db = admin();
    const email = user.email ? user.email.toLowerCase() : null;

    // Same lookup order as the GET: the row linked to this member, else by email.
    let row = null;
    const r1 = await db.from('run_registrations').select('id')
      .eq('member_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    row = r1.data || null;
    if (!row && email) {
      const r2 = await db.from('run_registrations').select('id')
        .eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
      row = r2.data || null;
    }

    if (row) {
      const { error } = await db.from('run_registrations').update(patch).eq('id', row.id);
      if (error) {
        console.error('[run-profile] update error:', error);
        return res.status(500).json({ error: 'Could not save your details' });
      }
    } else {
      if (!email) return res.status(400).json({ error: 'Your account has no email on file' });
      const meta = user.user_metadata || {};
      const fullName = String(meta.full_name || meta.name || '').trim();
      const parts = fullName ? fullName.split(/\s+/) : [];
      const insert = Object.assign({
        member_id: user.id,
        email,
        first_name: parts[0] || email.split('@')[0],
        last_name: parts.slice(1).join(' ') || ''
      }, patch);
      const { error } = await db.from('run_registrations').upsert(insert, { onConflict: 'email' });
      if (error) {
        console.error('[run-profile] insert error:', error);
        return res.status(500).json({ error: 'Could not save your details' });
      }
    }

    return res.status(200).json({
      ok: true,
      whatsapp: whatsapp_e164 || null,
      instagram_handle: instagram_handle || null
    });
  } catch (e) {
    console.error('[/api/run-profile POST]', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
