// POST /api/book - books a session using a credit (atomic via RPC).
// Body: { session_id }. Returns 200 {ok,credits_left} or 409 with a reason
// (No credits / full / already booked) so the UI can offer to buy instead.
// Body { join: TOKEN } instead books a friend onto a host's held spot with the friend's
// OWN credit (book_from_hold); the station comes from the hold.
// On a Sunday the admin made free (sessions.is_free) both paths book at AED 0 and take no
// credit: book_free, and book_from_hold with 'free'.
// Also fires a branded LFG confirmation email + .ics calendar invite.
const { admin, getUser, ensureMember } = require('./_lib');
const { sendBookingConfirmation } = require('./_email');
const manychat = require('./_manychat');
const F = require('./_friends');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const body = req.body || {};
  if (body.join != null) return bookFromJoin(res, user, String(body.join));
  const sessionId = body.session_id;
  const section = body.section;
  // ManyChat subscriber id, present only when the visitor came from an Instagram DM link.
  const mc_id = manychat.cleanMcId(body.mc_id);
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });
  if (!/^[A-Z]$/.test(section)) return res.status(400).json({ error: 'Pick a station' });

  const db = admin();
  try {
    await ensureMember(db, user);
    const { data: sess } = await db.from('sessions').select('session_date,location,is_free').eq('id', sessionId).maybeSingle();
    const free = !!(sess && sess.is_free);
    const { data, error } = await db.rpc(free ? 'book_free' : 'book_with_credit', { p_member: user.id, p_session: sessionId, p_section: section });
    if (error) throw new Error(error.message);
    if (!data || !data.ok) return res.status(409).json(data || { ok: false, error: 'Could not book' });

    // Send confirmation with the session's date + location.
    try {
      if (sess) {
        const r = await sendBookingConfirmation(db, {
          kind: 'single',
          memberId: user.id,
          sessionId,
          sessionDate: sess.session_date,
          section: data.section || section,
          location: sess.location || 'CrossFit Alioth',
          paidAmount: 0,
          creditsLeft: data.credits_left,
          free
        });
        if (!r.ok) console.warn('[book] confirmation email skipped:', r.error);
      }
    } catch (e) { console.warn('[book] confirmation email threw:', e.message); }

    // ManyChat: a credit booking that started from a DM link tags the subscriber booked-bootcamp.
    if (mc_id) { try { await manychat.tagSubscriber(mc_id, manychat.TAGS.bootcamp); } catch (e) { console.warn('[book → manychat]', e && e.message); } }

    res.status(200).json(data);
  } catch (e) {
    console.error('[/api/book]', e);
    res.status(500).json({ error: 'Booking failed' });
  }
};

// A friend claims a held spot with their own credit.
async function bookFromJoin(res, user, token) {
  if (!F.validToken(token)) return res.status(400).json({ ok: false, error: 'This invite link is not valid.' });
  const db = admin();
  try {
    await ensureMember(db, user);
    const { data: h } = await db.from('booking_holds').select('id,session_id,host_member_id')
      .eq('token', token).eq('kind', 'invite').maybeSingle();
    if (!h) return res.status(404).json({ ok: false, error: 'This invite link is not valid.' });
    const { data: sess } = await db.from('sessions').select('session_date,start_time,location,status,is_free').eq('id', h.session_id).maybeSingle();
    if (!F.bookingOpen(sess, Date.now())) return res.status(409).json({ ok: false, error: 'Booking has closed for this Sunday.' });
    const free = !!sess.is_free;

    const { data, error } = await db.rpc('book_from_hold', { p_member: user.id, p_hold: h.id, p_payment: free ? 'free' : 'credit', p_amount: 0 });
    if (error) throw new Error(error.message);
    if (!data || !data.ok) return res.status(409).json(data || { ok: false, error: 'Could not book' });

    try {
      const { data: host } = await db.from('members').select('full_name').eq('id', h.host_member_id).maybeSingle();
      const hostFirst = F.firstName(host && host.full_name);
      const r = await sendBookingConfirmation(db, {
        kind: 'single', memberId: user.id, sessionId: h.session_id, sessionDate: sess.session_date,
        section: data.section, location: sess.location || 'CrossFit Alioth', paidAmount: 0,
        creditsLeft: data.credits_left, free,
        note: hostFirst ? "You're training with " + hostFirst + '.' : null
      });
      if (!r.ok) console.warn('[book join] confirmation email skipped:', r.error);
    } catch (e) { console.warn('[book join] confirmation email threw:', e.message); }

    return res.status(200).json(data);
  } catch (e) {
    console.error('[/api/book join]', e);
    return res.status(500).json({ error: 'Booking failed' });
  }
}
