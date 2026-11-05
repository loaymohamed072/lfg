// /api/whatsapp-number - the no-login page behind the "Add your WhatsApp number" email.
// The link carries a 64-hex token (whatsapp_requests, sql/2026-11-05_whatsapp_requests.sql)
// tied to one member; it can only set that member's number, until it runs out.
//   GET  ?t=TOKEN          -> { ok, first_name, current }   current = masked number on file
//   POST { t, whatsapp }   -> { ok, whatsapp }               saves members.phone (E.164)
// A missing, unknown or expired token answers 410 { expired: true } either way, so the
// page never says which.
const { admin, whatsappE164, WHATSAPP_ERROR } = require('./_lib');

const TOKEN_RE = /^[0-9a-f]{64}$/;

// +971 50 123 4567 -> +971 •• ••• 4567: enough to recognise, not enough to copy.
function mask(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8) return null;
  return '+' + d.slice(0, d.length - 9 > 0 ? d.length - 9 : 3) + ' •• ••• ' + d.slice(-4);
}

async function liveRequest(db, token) {
  if (!TOKEN_RE.test(token || '')) return null;
  const { data } = await db.from('whatsapp_requests').select('token,member_id,expires_at').eq('token', token).maybeSingle();
  if (!data || !(Date.parse(data.expires_at) > Date.now())) return null;
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const db = admin();
  const token = String(req.method === 'GET' ? (req.query && req.query.t) || '' : (req.body && req.body.t) || '');

  try {
    const r = await liveRequest(db, token);
    if (!r) return res.status(410).json({ ok: false, expired: true });

    if (req.method === 'GET') {
      const { data: m } = await db.from('members').select('full_name,phone').eq('id', r.member_id).maybeSingle();
      const first = String((m && m.full_name) || '').trim().split(/\s+/)[0] || null;
      return res.status(200).json({ ok: true, first_name: first, current: mask(m && m.phone) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const phone = whatsappE164(req.body && req.body.whatsapp);
    if (!phone) return res.status(400).json({ ok: false, error: WHATSAPP_ERROR });
    const { error } = await db.from('members').update({ phone }).eq('id', r.member_id);
    if (error) throw new Error(error.message);
    await db.from('whatsapp_requests').update({ saved_at: new Date().toISOString() }).eq('token', r.token);
    return res.status(200).json({ ok: true, whatsapp: phone });
  } catch (e) {
    console.error('[/api/whatsapp-number]', e && e.message);
    return res.status(500).json({ ok: false, error: 'Could not save your number. Try again in a minute.' });
  }
};

module.exports.mask = mask;
