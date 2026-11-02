// /api/friends - train with a friend (2026-11-02).
//   GET  ?token=T          PUBLIC. The invite landing (/bootcamp?join=T): Sunday, station,
//                          host first name, spots left, price. With a Bearer it adds whether
//                          the viewer is the host, is already booked, and their credits.
//   GET  ?session_id=S     Bearer. The host's panel: their station, how many more spots they
//                          can hold, and their live invite links.
//   POST { action:'hold', session_id, spots }   Bearer. Hold 1-7 spots on the host's station.
//   POST { action:'cancel', hold_id }           Bearer. The host releases a hold.
//   POST { action:'invite', hold_id, email }    Bearer. Email the link to an EXISTING member.
//
// Privacy: an email invite matches one exact address. A miss answers "not on LFG yet" and
// nothing more; a hit answers "sent" and never shows the member's name. Every attempt, hit
// or miss, counts toward 10 per link and 20 per host per day (a miss is kept only as a
// hash), and mail only reaches addresses already on LFG, so the endpoint can neither mail
// strangers nor be used to sweep for members. The rules themselves (station room, 7 spots,
// 24 hours, expiry) live in create_booking_hold / book_from_hold.
const crypto = require('crypto');
const { admin, getUser, formatDate, earlyWeekPromo, earlyWeekPrice, canonicalOrigin, safeError } = require('./_lib');
const F = require('./_friends');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const db = admin();
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.token != null) return await landing(req, res, db, String(q.token));
      if (q.session_id) return await hostView(req, res, db, String(q.session_id));
      return res.status(400).json({ error: 'Missing token or session_id' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const body = req.body || {};
    if (body.action === 'hold') return await createHold(req, res, db, user, body);
    if (body.action === 'cancel') return await cancelHold(res, db, user, body);
    if (body.action === 'invite') return await invite(req, res, db, user, body);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return safeError(res, 'friends', e, 'Something went wrong. Try again.');
  }
};

function linkFor(req, token) { return canonicalOrigin(req) + '/bootcamp?join=' + token; }

function sessionOut(s) {
  return s ? { id: s.id, session_date: s.session_date, start_time: s.start_time || null,
    date_label: formatDate(s.session_date, s.start_time), location: s.location || 'CrossFit Alioth' } : null;
}

function creditsFrom(rows) {
  const now = Date.now();
  return (rows || []).reduce((a, p) => a + (p.status === 'active' && p.sessions_remaining > 0 && Date.parse(p.expires_at) > now ? p.sessions_remaining : 0), 0);
}

// A friend's price for this host's booking, today (see friendPrice in _friends.js).
async function priceForHost(db, booking) {
  const [early, cfgPct] = await Promise.all([earlyWeekPromo(db), F.promoConfigPct(db)]);
  return F.friendPrice({
    list: F.listPrice(), nowPct: early.active ? early.percent : 0, cfgPct,
    hostPaid: booking && booking.payment_type === 'single' ? booking.amount_paid_aed : 0
  });
}

async function landing(req, res, db, token) {
  if (!F.validToken(token)) return res.status(404).json({ ok: false, status: 'invalid', error: 'This invite link is not valid.' });
  const { data: h } = await db.from('booking_holds')
    .select('id,session_id,section,host_member_id,spots,claimed,price_aed,expires_at,cancelled_at')
    .eq('token', token).eq('kind', 'invite').maybeSingle();
  if (!h) return res.status(404).json({ ok: false, status: 'invalid', error: 'This invite link is not valid.' });

  const [{ data: sess }, { data: host }, early] = await Promise.all([
    db.from('sessions').select('id,session_date,start_time,location,status,is_free').eq('id', h.session_id).maybeSingle(),
    db.from('members').select('full_name').eq('id', h.host_member_id).maybeSingle(),
    earlyWeekPromo(db)
  ]);
  const now = Date.now();
  let status = F.holdState(h, now);
  if (status === 'active' && !F.bookingOpen(sess, now)) status = 'closed';

  let viewer = null;
  const user = await getUser(req).catch(() => null);
  if (user) {
    const [{ data: bk }, { data: pk }] = await Promise.all([
      db.from('bookings').select('status').eq('member_id', user.id).eq('session_id', h.session_id).maybeSingle(),
      db.from('member_packages').select('sessions_remaining,expires_at,status').eq('member_id', user.id)
    ]);
    viewer = {
      is_host: user.id === h.host_member_id,
      booked: !!(bk && (bk.status === 'booked' || bk.status === 'attended')),
      credits: creditsFrom(pk)
    };
  }

  return res.status(200).json({
    ok: true,
    status,                                   // active | expired | cancelled | full | closed
    session: sessionOut(sess),
    station: h.section,
    host_first_name: F.firstName(host && host.full_name) || null,
    spots_left: status === 'active' ? h.spots - h.claimed : 0,
    price_aed: sess && sess.is_free ? 0 : Math.min(Number(h.price_aed), earlyWeekPrice(F.listPrice(), early)),
    free: !!(sess && sess.is_free),
    expires_at: h.expires_at,
    viewer
  });
}

async function hostView(req, res, db, sessionId) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'Missing session_id' });
  const [{ data: sess }, { data: bk }, { data: mine }] = await Promise.all([
    db.from('sessions').select('id,session_date,start_time,location,status,capacity,stations,is_free').eq('id', sessionId).maybeSingle(),
    db.from('bookings').select('section,status,payment_type,amount_paid_aed').eq('member_id', user.id).eq('session_id', sessionId).maybeSingle(),
    db.from('booking_holds').select('id,token,spots,claimed,expires_at')
      .eq('host_member_id', user.id).eq('session_id', sessionId).eq('kind', 'invite')
      .is('cancelled_at', null).gt('expires_at', new Date().toISOString()).order('created_at')
  ]);
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  if (!bk || bk.status !== 'booked') return res.status(200).json({ ok: true, booked: false });

  const holds = (mine || []).map((h) => ({
    id: h.id, link: linkFor(req, h.token), spots: h.spots, claimed: h.claimed, left: h.spots - h.claimed, expires_at: h.expires_at
  }));
  const open = F.bookingOpen(sess, Date.now());
  const held = holds.reduce((a, h) => a + h.spots, 0);
  const load = await F.stationLoad(db, sessionId, bk.section);
  const stationRoom = F.stationRoom(sess.capacity, sess.stations, bk.section, load.booked, load.held);
  return res.status(200).json({
    ok: true, booked: true, open, section: bk.section,
    room: open ? Math.max(0, Math.min(7 - held, stationRoom)) : 0,
    station_room: stationRoom, held, holds,
    // On a free Sunday friends join free too.
    price_aed: sess.is_free ? 0 : await priceForHost(db, bk),
    free: !!sess.is_free,
    session: sessionOut(sess)
  });
}

async function createHold(req, res, db, user, body) {
  const spots = Math.round(Number(body.spots));
  if (!Number.isInteger(spots) || spots < 1 || spots > 7) return res.status(400).json({ error: 'Hold between 1 and 7 spots.' });
  const sessionId = String(body.session_id || '');
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'Missing session_id' });
  const [{ data: sess }, { data: bk }] = await Promise.all([
    db.from('sessions').select('id,session_date,start_time,status,is_free').eq('id', sessionId).maybeSingle(),
    db.from('bookings').select('status,payment_type,amount_paid_aed').eq('member_id', user.id).eq('session_id', sessionId).maybeSingle()
  ]);
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  if (!F.bookingOpen(sess, Date.now())) return res.status(409).json({ error: 'Booking has closed for this Sunday.' });
  if (!bk || bk.status !== 'booked') return res.status(409).json({ error: 'Book your own spot first, then hold spots for friends.' });

  const price = sess.is_free ? 0 : await priceForHost(db, bk);
  const { data: r, error } = await db.rpc('create_booking_hold', {
    p_host: user.id, p_session: sessionId, p_kind: 'invite', p_spots: spots, p_price: price, p_section: null, p_friends: null
  });
  if (error) throw new Error('create_booking_hold: ' + error.message);
  if (!r || !r.ok) return res.status(409).json({ error: (r && r.error) || 'Could not hold the spots.', room: r && r.room });
  return res.status(200).json({
    ok: true, price_aed: price, free: !!sess.is_free,
    hold: { id: r.hold_id, link: linkFor(req, r.token), spots, claimed: 0, left: spots, expires_at: r.expires_at }
  });
}

async function cancelHold(res, db, user, body) {
  const id = String(body.hold_id || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Missing hold_id' });
  const { data, error } = await db.from('booking_holds').update({ cancelled_at: new Date().toISOString() })
    .eq('id', id).eq('host_member_id', user.id).eq('kind', 'invite').is('cancelled_at', null).select('id');
  if (error) throw new Error('cancel hold: ' + error.message);
  if (!data || !data.length) return res.status(404).json({ error: 'That hold has already ended.' });
  return res.status(200).json({ ok: true });
}

async function invite(req, res, db, user, body) {
  const email = F.cleanEmail(body.email);
  if (!email) return res.status(400).json({ error: 'Enter an email.' });
  if (email === String(user.email || '').toLowerCase()) return res.status(400).json({ error: "That's your own email." });
  const id = String(body.hold_id || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Missing hold_id' });

  const { data: h } = await db.from('booking_holds')
    .select('id,token,session_id,section,spots,claimed,price_aed,expires_at,cancelled_at')
    .eq('id', id).eq('host_member_id', user.id).eq('kind', 'invite').maybeSingle();
  if (!h) return res.status(404).json({ error: 'That hold has already ended.' });
  if (F.holdState(h, Date.now()) !== 'active') return res.status(409).json({ error: 'This link has ended. Make a new one.' });

  const { data: me } = await db.from('members').select('full_name').eq('id', user.id).maybeSingle();
  const hostFirst = F.firstName(me && me.full_name);
  if (!hostFirst) return res.status(409).json({ error: 'Add your name in My Account first, so your friend knows the invite is from you.', needs_name: true });

  // Exact match only, and nothing about a miss beyond "not on LFG yet". record_hold_invite
  // counts every attempt (a miss as a hash of the address) under one lock per host, so the
  // caps hold under parallel requests and answer the same for members and strangers.
  const { data: found } = await db.from('members').select('id,full_name').eq('email', email).limit(1);
  const friend = found && found[0] && found[0].id !== user.id ? found[0] : null;
  const hash = crypto.createHash('sha256').update(email).digest('hex');
  const MISS = { ok: true, sent: false, message: 'Not on LFG yet. Send them your link.' };
  const { data: rec, error: recErr } = await db.rpc('record_hold_invite', {
    p_host: user.id, p_hold: h.id, p_email_sha256: hash, p_member: friend ? friend.id : null
  });
  if (recErr) throw new Error('record_hold_invite: ' + recErr.message);
  if (!rec || !rec.ok) {
    const reason = rec && rec.reason;
    if (reason === 'hold_cap') return res.status(429).json({ error: 'You sent the most invites for this link. Share the link instead.' });
    if (reason === 'day_cap') return res.status(429).json({ error: 'You sent a lot of invites today. Share your link instead.' });
    return res.status(409).json({ error: 'This link has ended. Make a new one.' });
  }
  if (rec.repeat) return res.status(200).json(rec.invited_member_id ? { ok: true, sent: true, message: 'Already sent to that email.' } : MISS);
  if (!friend) return res.status(200).json(MISS);

  const [{ data: sess }, early] = await Promise.all([
    db.from('sessions').select('session_date,start_time,location,is_free').eq('id', h.session_id).maybeSingle(),
    earlyWeekPromo(db)
  ]);
  const { sendFriendInvite, formatTime12 } = require('./_email');
  const until = new Date(h.expires_at).toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
  });
  const sent = await sendFriendInvite({
    to: email, firstName: F.firstName(friend.full_name), hostFirst,
    sessionDate: sess && sess.session_date, timeLabel: formatTime12(sess && sess.start_time),
    location: sess && sess.location, section: h.section,
    priceAed: sess && sess.is_free ? 0 : Math.min(Number(h.price_aed), earlyWeekPrice(F.listPrice(), early)),
    free: !!(sess && sess.is_free),
    link: linkFor(req, h.token), untilLabel: until
  });
  if (!sent.ok) {
    await db.from('booking_hold_invites').delete().eq('hold_id', h.id).eq('email_sha256', hash);
    return res.status(502).json({ error: 'Could not send it. Share your link instead.' });
  }
  return res.status(200).json({ ok: true, sent: true, message: 'Invite sent.' });
}
