// POST /api/cancel-booking - cancel one of the caller's bookings.
// Body: { booking_id }
// Server-side enforces the 08:00 Asia/Dubai same-day cutoff via cancel_booking() RPC.
const { admin, getUser, safeError } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  const bookingId = String(body.booking_id || '').trim();
  if (!bookingId) return res.status(400).json({ error: 'Missing booking_id' });

  try {
    const db = admin();
    const { data, error } = await db.rpc('cancel_booking', {
      p_user_id: user.id,
      p_booking_id: bookingId
    });
    if (error) return safeError(res, 'cancel-booking', error, 'Could not cancel booking');
    if (!data || data.ok !== true) {
      return res.status(400).json({ error: (data && data.error) || 'Could not cancel' });
    }
    return res.status(200).json(data);
  } catch (e) {
    return safeError(res, 'cancel-booking', e, 'Could not cancel booking');
  }
};
