// POST /api/profile - member sets their display name and/or WhatsApp number.
// Body: { full_name?, whatsapp? } (at least one).
const { admin, getUser, ensureMember, whatsappE164, WHATSAPP_ERROR } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  const patch = {};
  if (body.full_name != null) {
    const name = String(body.full_name).trim();
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Please enter your name' });
    patch.full_name = name;
  }
  if (body.whatsapp != null) {
    const phone = whatsappE164(body.whatsapp);
    if (!phone) return res.status(400).json({ error: WHATSAPP_ERROR, field: 'whatsapp' });
    patch.phone = phone;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Please enter your name' });

  const db = admin();
  try {
    await ensureMember(db, user);
    const { error } = await db.from('members').update(patch).eq('id', user.id);
    if (error) throw new Error(error.message);
    res.status(200).json({ ok: true, full_name: patch.full_name, whatsapp: patch.phone });
  } catch (e) {
    console.error('[/api/profile]', e);
    res.status(500).json({ error: patch.phone ? 'Could not save your number. Try again.' : 'Could not save name' });
  }
};
