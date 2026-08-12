// POST /api/admin/issue-runner-promo - admin-only.
// Generates a personal, email-locked, single-use promo code for a specific runner
// and returns a pre-filled WhatsApp deep link so Ahmed can tap to send the invite.
//
// Body: { runner_id, kind?: 'percent'|'amount', value?: number, expires_days?: number, message?: string }
// Defaults: kind=amount, value=50 (AED off a 99 AED single), expires_days=14
const crypto = require('crypto');
const { admin, getUser, isAdmin } = require('../_lib');

function generateCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return 'RUN-' + out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const runnerId = String(body.runner_id || '').trim();
  if (!runnerId) return res.status(400).json({ error: 'Missing runner_id' });

  const kind = body.kind === 'percent' ? 'percent' : 'fixed';
  let value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) value = (kind === 'percent' ? 50 : 50);
  if (kind === 'percent' && value > 100) return res.status(400).json({ error: 'Percent value too high' });

  let expiresDays = Number(body.expires_days);
  if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 90) expiresDays = 14;

  try {
    const { data: runner, error: rErr } = await db.from('run_registrations')
      .select('id,email,first_name,whatsapp_e164')
      .eq('id', runnerId)
      .maybeSingle();
    if (rErr) return res.status(500).json({ error: rErr.message });
    if (!runner) return res.status(404).json({ error: 'Runner not found' });

    // Generate a code, retry on the very-rare collision.
    let code = generateCode();
    for (let i = 0; i < 4; i++) {
      const { data: hit } = await db.from('promo_codes').select('code').eq('code', code).maybeSingle();
      if (!hit) break;
      code = generateCode();
    }

    const expires = new Date(Date.now() + expiresDays * 86400 * 1000).toISOString();
    const { error: insErr } = await db.from('promo_codes').insert({
      code,
      kind,
      value,
      active: true,
      max_redemptions: 1,
      expires_at: expires,
      email_lock: runner.email
    });
    if (insErr) return res.status(500).json({ error: insErr.message });

    const discountLabel = kind === 'percent' ? value + '% off' : 'AED ' + value + ' off';
    const message = body.message && typeof body.message === 'string'
      ? body.message
      : 'Hey ' + (runner.first_name || 'there') + ', it\'s LFG. Saw you\'ve been at the runs. Try Sunday bootcamp on us with code *' + code + '* (' + discountLabel + ', expires in ' + expiresDays + ' days). Reserve here: https://lfgdubai.com/bootcamp.html';

    const phoneDigits = (runner.whatsapp_e164 || '').replace(/[^\d]/g, '');
    const whatsappLink = phoneDigits
      ? 'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent(message)
      : null;

    res.status(200).json({ ok: true, code, expires_at: expires, whatsapp_link: whatsappLink, message });
  } catch (e) {
    console.error('[/api/admin/issue-runner-promo]', e);
    res.status(500).json({ error: 'Server error' });
  }
};
