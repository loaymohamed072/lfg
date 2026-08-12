// POST /api/profile - member sets/updates their display name. Body: { full_name }
const { admin, getUser, ensureMember } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const name = ((req.body && req.body.full_name) || '').trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Please enter your name' });

  const db = admin();
  try {
    await ensureMember(db, user);
    const { error } = await db.from('members').update({ full_name: name }).eq('id', user.id);
    if (error) throw new Error(error.message);
    res.status(200).json({ ok: true, full_name: name });
  } catch (e) {
    console.error('[/api/profile]', e);
    res.status(500).json({ error: 'Could not save name' });
  }
};
