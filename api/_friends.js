// Train with a friend (2026-11-02): helpers shared by /api/friends, /api/book,
// /api/checkout, /api/sessions and Stripe fulfilment. The rules live in the database
// (sql/2026-11-02_train_with_friends.sql); this file prices, validates and talks to Stripe.
//
// No top-level requires, so node:test loads it without node_modules
// (scripts/friends.test.js). Supabase, Stripe and the email layer are required lazily.

const MAX_FRIENDS = 7;
const BOOK_GRACE_MS = 135 * 60 * 1000;     // booking stays open 135 min after start (api/sessions.js)
const INVITES_PER_HOLD = 10;
const INVITES_PER_DAY = 20;
const CHECKOUTS_PER_HOUR = 6;              // mirrors create_booking_hold
const STRIPE_EXPIRE_MIN = 31;              // Stripe's floor is 30 min; the hold lasts 35
const TOKEN_RE = /^[a-f0-9]{64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}
function cleanName(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, 80); }
function firstName(full) { return String(full || '').trim().split(/\s+/)[0] || ''; }
function validToken(t) { return typeof t === 'string' && TOKEN_RE.test(t); }

// Friends typed in at checkout: a name and an email each, no repeats, never the buyer.
// Rows left completely blank are ignored, so an empty "+ Add a friend" row costs nothing.
function cleanFriends(list, buyerEmail) {
  if (list == null) return { ok: true, friends: [] };
  if (!Array.isArray(list)) return { ok: false, error: 'Add your friends again.' };
  const rows = list.filter((f) => f && (String(f.name || '').trim() || String(f.email || '').trim()));
  if (rows.length > MAX_FRIENDS) return { ok: false, error: 'You can bring up to 7 friends.' };
  const me = String(buyerEmail || '').trim().toLowerCase();
  const seen = new Set();
  const out = [];
  for (const f of rows) {
    const name = cleanName(f.name);
    const email = cleanEmail(f.email);
    if (!name) return { ok: false, error: 'Add a name for each friend.' };
    if (!email) return { ok: false, error: 'Check the email for ' + name + '.' };
    if (me && email === me) return { ok: false, error: "That's your own email. Add your friend's." };
    if (seen.has(email)) return { ok: false, error: email + ' is on the list twice.' };
    seen.add(email);
    out.push({ name, email });
  }
  return { ok: true, friends: out };
}

// What a friend pays: the normal ticket, today. When the host paid the Monday to
// Wednesday price by card, the friend keeps that price later in the week. A host's promo
// code never carries over (it never lands exactly on the early-week price), and a host
// who booked with a credit locks today's price. Never more than today's price.
//   list    single-session list price (SINGLE_SESSION_PRICE_AED)
//   nowPct  early-week percent active right now (0 outside Monday to Wednesday)
//   cfgPct  the configured early-week percent, active or not
//   hostPaid what the host paid for their own seat (0 for a credit booking)
function friendPrice({ list, nowPct, cfgPct, hostPaid }) {
  const L = Number(list) || 0;
  const at = (p) => Math.round(L * (100 - p) / 100);
  const now = Number(nowPct) > 0 ? at(Number(nowPct)) : L;
  const paid = Number(hostPaid) || 0;
  const hostEarly = Number(cfgPct) > 0 && paid > 0 && paid === at(Number(cfgPct));
  return Math.min(now, hostEarly ? paid : L);
}

// 'active' | 'cancelled' | 'expired' | 'full' | 'invalid'
function holdState(h, nowMs) {
  if (!h) return 'invalid';
  if (h.cancelled_at) return 'cancelled';
  if (!(Date.parse(h.expires_at) > nowMs)) return 'expired';
  if (Number(h.claimed) >= Number(h.spots)) return 'full';
  return 'active';
}

// Same window as /api/sessions: a Sunday takes bookings until 135 minutes after it starts.
function bookingOpen(sess, nowMs) {
  if (!sess || sess.status !== 'open') return false;
  const t = Date.parse(sess.session_date + 'T' + (sess.start_time || '12:30:00') + '+04:00');
  return isNaN(t) ? true : t + BOOK_GRACE_MS >= nowMs;
}

function sectionCap(total, idx, n) { return Math.floor(total / n) + (idx < (total % n) ? 1 : 0); }

// Live held spots from booking_holds rows: { [session_id]: { total, sections: { A: n } } }.
function heldBySession(rows, nowMs) {
  const out = {};
  (rows || []).forEach((h) => {
    if (holdState(h, nowMs) !== 'active') return;
    const left = Number(h.spots) - Number(h.claimed);
    const e = out[h.session_id] || (out[h.session_id] = { total: 0, sections: {} });
    e.total += left;
    e.sections[h.section] = (e.sections[h.section] || 0) + left;
  });
  return out;
}

// Room on one station once bookings and live holds are counted, never below zero.
function stationRoom(capacity, stations, section, booked, held) {
  const n = stations || 4;
  const idx = String(section || '').charCodeAt(0) - 65;
  if (!(idx >= 0 && idx < n)) return 0;
  return Math.max(0, sectionCap(capacity, idx, n) - (booked || 0) - (held || 0));
}

// After book_group_paid: who got a seat, who already had one, and what to refund.
// Nobody booked means a full refund; anyone already booked gets their ticket back.
function planGroupOutcome({ result, buyerId, buyerAmount, friendAmount, paid }) {
  const total = Number(paid) || 0;
  if (!result || !result.ok) return { full: true, refund: total, booked: [], already: [] };
  const booked = (result.booked || []).map((b) => b.member_id);
  const already = result.already || [];
  if (!booked.length) return { full: true, refund: total, booked, already };
  let refund = 0;
  already.forEach((id) => { refund += id === buyerId ? Number(buyerAmount) || 0 : Number(friendAmount) || 0; });
  refund = Math.min(total, Math.round(refund * 100) / 100);
  return { full: false, refund, booked, already };
}

// "Ali", "Ali and Mona", "Ali, Mona and Sam"
function joinNames(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

// ------------------------------------------------------------------ database reads

function nowIso() { return new Date().toISOString(); }

async function liveHolds(db, sessionIds) {
  if (!sessionIds || !sessionIds.length) return [];
  const { data, error } = await db.from('booking_holds')
    .select('session_id,section,spots,claimed,expires_at,cancelled_at')
    .in('session_id', sessionIds).is('cancelled_at', null).gt('expires_at', nowIso());
  // Before the migration runs the table does not exist: count no holds rather than fail.
  if (error) { console.warn('[friends] live holds:', error.message); return []; }
  return data || [];
}

// Bookings and live holds on one station of one session.
async function stationLoad(db, sessionId, section) {
  const [bk, holds] = await Promise.all([
    db.from('bookings').select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId).eq('section', section).in('status', ['booked', 'attended']),
    liveHolds(db, [sessionId])
  ]);
  const held = heldBySession(holds, Date.now())[sessionId];
  return { booked: bk.count || 0, held: held ? (held.sections[section] || 0) : 0, heldTotal: held ? held.total : 0 };
}

async function promoConfigPct(db) {
  const { data } = await db.from('event_config').select('bootcamp_promo_pct').eq('id', 1).maybeSingle();
  return Math.max(0, Math.min(90, Number(data && data.bootcamp_promo_pct) || 0));
}

function listPrice() { return Number(process.env.SINGLE_SESSION_PRICE_AED || 99); }

// Members for the friends a buyer pays for. An existing member is linked by exact email;
// anyone new becomes a guest member (createGuestMember: confirmed, passwordless, nothing
// sent), so they can sign in with that email later and find the booking. An email that
// already has a login but no LFG row (a coaching-only account) gets its row added.
async function memberIdsForFriends(db, friends, buyerId) {
  const { createGuestMember, authService } = require('./_lib');
  const out = [];
  for (const f of friends) {
    const { data: known } = await db.from('members').select('id').eq('email', f.email).limit(1);
    let id = known && known.length ? known[0].id : null;
    if (!id) {
      try {
        id = (await createGuestMember(db, { name: f.name, email: f.email, guestOf: buyerId })).memberId;
      } catch (e) {
        if (!/no member row/.test(e.message || '')) throw e;
        // generateLink only builds a link, it sends nothing; it is the one admin call
        // that resolves an existing login by email.
        const { data: link } = await authService().auth.admin.generateLink({ type: 'magiclink', email: f.email });
        const uid = link && link.user && link.user.id;
        if (!uid) throw e;
        const { error: upErr } = await db.from('members').upsert({ id: uid, email: f.email, full_name: f.name }, { onConflict: 'id' });
        if (upErr) throw new Error('friend member: ' + upErr.message);
        id = uid;
      }
    }
    if (id && id !== buyerId && !out.some((o) => o.member_id === id)) out.push({ member_id: id, name: f.name, email: f.email });
  }
  return out;
}

// ------------------------------------------------------------------ Stripe

// Refund a paid checkout, in full (amountAed null) or in part. One refund per checkout
// session (idempotency key), so a replayed webhook cannot refund twice. Never throws: a
// failed refund is logged loudly for a manual refund and the caller carries on.
async function refundCheckout(db, sessionObj, { amountAed, keptAed, reason }) {
  const paid = (sessionObj.amount_total || 0) / 100;
  if (!sessionObj.payment_intent || !(paid > 0)) return { ok: true, skipped: true };
  const full = amountAed == null || Number(amountAed) >= paid;
  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const params = { payment_intent: sessionObj.payment_intent, metadata: { lfg_reason: reason || 'unplaced' } };
    if (!full) params.amount = Math.round(Number(amountAed) * 100);
    const r = await stripe.refunds.create(params, { idempotencyKey: 'lfg-refund-' + sessionObj.id });
    const patch = full ? { status: 'refunded' } : { amount_aed: Math.round(Number(keptAed) * 100) / 100 };
    await db.from('payments').update(patch).eq('stripe_session_id', sessionObj.id);
    return { ok: true, id: r.id, full };
  } catch (e) {
    console.error('[friends] REFUND FAILED, refund by hand in Stripe. session=' + sessionObj.id +
      ' pi=' + sessionObj.payment_intent + ' amount=' + (full ? paid : amountAed) + ':', e && e.message);
    return { ok: false, error: e && e.message };
  }
}

// ------------------------------------------------------------------ fulfilment

async function sessionFor(db, sessionId) {
  const { data } = await db.from('sessions').select('session_date,start_time,location').eq('id', sessionId).maybeSingle();
  return data;
}

async function namesFor(db, ids) {
  if (!ids.length) return {};
  const { data } = await db.from('members').select('id,full_name,email').in('id', ids);
  const out = {};
  (data || []).forEach((m) => { out[m.id] = m; });
  return out;
}

// A card payment that could not become a seat: refund it and tell the buyer plainly.
async function refundUnplaced(db, sessionObj, { memberId, sessionId, reason, group }) {
  const refund = await refundCheckout(db, sessionObj, { amountAed: null, reason });
  try {
    const { sendRefundNotice } = require('./_email');
    const [sess, who] = await Promise.all([sessionFor(db, sessionId), namesFor(db, [memberId])]);
    const m = who[memberId];
    if (m && m.email) {
      await sendRefundNotice({
        to: m.email, firstName: firstName(m.full_name), sessionDate: sess && sess.session_date,
        amount: (sessionObj.amount_total || 0) / 100, group: !!group, refunded: refund.ok, reason
      });
    }
  } catch (e) { console.warn('[friends] refund email skipped:', e && e.message); }
  return refund;
}

// kind 'group': the buyer plus friends, one station. Returns { refundedAll } or { error }.
async function fulfilGroup(db, sessionObj, md) {
  const paid = (sessionObj.amount_total || 0) / 100;
  const buyerAmount = Number(md.buyer_amount) || 0;
  const friendAmount = Number(md.friend_amount) || 0;
  const { data: hold } = await db.from('booking_holds').select('id,session_id,section,friends').eq('id', md.hold_id).maybeSingle();
  const friends = hold && Array.isArray(hold.friends) ? hold.friends : [];

  let result = { ok: false, reason: 'no_hold' };
  if (hold && hold.session_id === md.session_id) {
    const r = await db.rpc('book_group_paid', {
      p_buyer: md.member_id, p_session: md.session_id, p_section: hold.section || md.section || null,
      p_friends: friends.map((f) => f.member_id).filter(Boolean),
      p_buyer_amount: buyerAmount, p_friend_amount: friendAmount, p_hold: hold.id
    });
    if (r.error) return { error: 'book_group_paid: ' + r.error.message };
    result = r.data;
  }

  const plan = planGroupOutcome({ result, buyerId: md.member_id, buyerAmount, friendAmount, paid });
  if (plan.full) {
    console.warn('[fulfill] group not placed, refunding:', result && (result.error || result.reason));
    await refundUnplaced(db, sessionObj, { memberId: md.member_id, sessionId: md.session_id,
      reason: (result && result.reason) || 'full', group: true });
    return { refundedAll: true };
  }
  let refunded = null;
  if (plan.refund > 0) {
    refunded = await refundCheckout(db, sessionObj, { amountAed: plan.refund, keptAed: paid - plan.refund, reason: 'already_booked' });
  }

  // Confirmations. Names are the ones the buyer typed, never a member's stored name.
  try {
    const { sendBookingConfirmation } = require('./_email');
    const sess = await sessionFor(db, md.session_id);
    if (!sess) return { refundedAll: false };
    const who = await namesFor(db, [md.member_id]);
    const buyerFirst = firstName(who[md.member_id] && who[md.member_id].full_name) || 'A friend';
    const nameOf = {};
    friends.forEach((f) => { nameOf[f.member_id] = f.name; });
    const newFriends = plan.booked.filter((id) => id !== md.member_id);
    const skipped = plan.already.filter((id) => id !== md.member_id).map((id) => nameOf[id]).filter(Boolean);
    const groupNames = newFriends.map((id) => nameOf[id]).filter(Boolean);
    let note = groupNames.length ? 'You booked ' + joinNames(groupNames) + ' on Station ' + result.section + ' with you.' : '';
    if (skipped.length) {
      note += ' ' + joinNames(skipped) + (skipped.length === 1 ? ' already had a spot' : ' already had spots') +
        (refunded && refunded.ok ? ', so we refunded AED ' + plan.refund + '.' : '. We will refund that ticket.');
    }
    await sendBookingConfirmation(db, {
      kind: 'single', memberId: md.member_id, sessionId: md.session_id, sessionDate: sess.session_date,
      section: result.section, location: sess.location || 'CrossFit Alioth',
      paidAmount: Math.round((paid - plan.refund) * 100) / 100, note: note.trim() || null
    });
    for (const id of newFriends) {
      await sendBookingConfirmation(db, {
        kind: 'single', memberId: id, sessionId: md.session_id, sessionDate: sess.session_date,
        section: result.section, location: sess.location || 'CrossFit Alioth',
        paidAmount: 0, bookedBy: buyerFirst
      });
    }
  } catch (e) { console.warn('[fulfill] group emails skipped:', e && e.message); }
  return { refundedAll: false };
}

module.exports = {
  MAX_FRIENDS, INVITES_PER_HOLD, INVITES_PER_DAY, CHECKOUTS_PER_HOUR, STRIPE_EXPIRE_MIN,
  cleanEmail, cleanName, firstName, validToken, cleanFriends, friendPrice, holdState, bookingOpen,
  sectionCap, heldBySession, stationRoom, planGroupOutcome, joinNames,
  liveHolds, stationLoad, promoConfigPct, listPrice, memberIdsForFriends,
  refundCheckout, refundUnplaced, fulfilGroup, sessionFor, namesFor
};
