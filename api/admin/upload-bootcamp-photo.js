// POST /api/admin/upload-bootcamp-photo - admin uploads the group photo for a
// session. Stored in the public `bootcamp-photos` bucket; the URL is recorded on
// the session and shown on the bootcamp page. Admin only.
// Body: { session_id, image_base64 (data URL or raw base64), content_type }
const { admin, getUser, isAdmin, authService } = require('../_lib');

const MAX_BYTES = 8 * 1024 * 1024; // decoded ceiling
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const sessionId = body.session_id;
  const ct = String(body.content_type || 'image/jpeg').toLowerCase();
  const b64 = String(body.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });
  if (!b64) return res.status(400).json({ error: 'Missing image' });
  if (!EXT[ct]) return res.status(400).json({ error: 'Use a JPG, PNG or WebP image' });

  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch (_) { return res.status(400).json({ error: 'Bad image data' }); }
  if (!buffer.length) return res.status(400).json({ error: 'Empty image' });
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'Image too large (max 8MB)' });

  try {
    const { data: sess } = await db.from('sessions').select('id,session_date').eq('id', sessionId).maybeSingle();
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const path = sess.session_date + '-' + Date.now() + '.' + EXT[ct];
    const storage = authService().storage.from('bootcamp-photos');
    const up = await storage.upload(path, buffer, { contentType: ct, upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { data: pub } = storage.getPublicUrl(path);
    const photoUrl = pub.publicUrl;

    const { error: updErr } = await db.from('sessions').update({ photo_url: photoUrl }).eq('id', sessionId);
    if (updErr) throw new Error(updErr.message);

    res.status(200).json({ ok: true, photo_url: photoUrl });
  } catch (e) {
    console.error('[/api/admin/upload-bootcamp-photo]', e);
    res.status(500).json({ error: 'Upload failed' });
  }
};
