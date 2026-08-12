// GET /api/push-key - the VAPID public key the browser needs to subscribe.
//
// Public by design: this key is the application-server identity, it is meant to
// ship to every client. The private half never leaves the server.
const { publicKey } = require('./_push');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const key = publicKey();
  if (!key) return res.status(200).json({ key: null, enabled: false });
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).json({ key, enabled: true });
};
