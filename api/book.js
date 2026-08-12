// POST /api/book - books a session using a credit (atomic via RPC).
// Body: { session_id }. Returns 200 {ok,credits_left} or 409 with a reason
// (No credits / full / already booked) so the UI can offer to buy instead.
// Also fires a branded LFG confirmation email + .ics calendar invite.
const { admin, getUser, ensureMember } = require('./_lib');
const { sendBookingConfirmation } = require('./_email');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  const sessionId = body.session_id;
  const section = body.section;
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });
  if (!/^[A-Z]$/.test(section)) return res.status(400).json({ error: 'Pick a station' });

  const db = admin();
  try {
    await ensureMember(db, user);
    const { data, error } = await db.rpc('book_with_credit', { p_member: user.id, p_session: sessionId, p_section: section });
    if (error) throw new Error(error.message);
    if (!data || !data.ok) return res.status(409).json(data || { ok: false, error: 'Could not book' });

    // Send confirmation. Look up the session so we know the date + location.
    try {
      const { data: sess } = await db.from('sessions').select('session_date,location').eq('id', sessionId).maybeSingle();
      if (sess) {
        const r = await sendBookingConfirmation(db, {
          kind: 'single',
          memberId: user.id,
          sessionId,
          sessionDate: sess.session_date,
          section: data.section || section,
          location: sess.location || 'CrossFit Alioth',
          paidAmount: 0,
          creditsLeft: data.credits_left
        });
        if (!r.ok) console.warn('[book] confirmation email skipped:', r.error);
      }
    } catch (e) { console.warn('[book] confirmation email threw:', e.message); }

    res.status(200).json(data);
  } catch (e) {
    console.error('[/api/book]', e);
    res.status(500).json({ error: 'Booking failed' });
  }
};
