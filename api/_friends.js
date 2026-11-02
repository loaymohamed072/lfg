// Train with a friend (2026-11-02): helpers shared by /api/friends, /api/book,
// /api/checkout, /api/sessions and Stripe fulfilment. The rules live in the database
// (sql/2026-11-02_train_with_friends.sql); this file prices, validates and talks to Stripe.
//
// No top-level requires, so node:test loads it without node_modules
// (scripts/friends.test.js). Supabase, Stripe and the email layer are required lazily.

const MAX_FRIENDS = 7;
const BOOK_GRACE_MS = 135 * 60 * 1000;     // booking stays open 135 min after start (api/sessions.js)
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

// The capacity a booker meets. Bookings plus held spots filling a Sunday below
// max_capacity make the next booking grow it by one bump_increment
// (bump_capacity_for_held in the migration), so held spots never show it as sold out.
// The database rounds capacity up to a whole pair per station (sessions_even_capacity).
function capacityForBooker(sess, booked, held) {
  const cap = Number(sess && sess.capacity) || 0;
  const max = Number(sess && sess.max_capacity) || cap;
  if (!((booked || 0) + (held || 0) >= cap && cap < max)) return cap;
  const step = 2 * Math.max(Number(sess.stations) || 4, 1);
  return Math.ceil(Math.min(cap + (Number(sess.bump_increment) || 10), max) / step) * step;
}

// Room on one station once bookings and live holds are counted, never below zero.
function stationRoom(capacity, stations, section, booked, held) {
  const n = stations || 4;
  const idx = String(section || '').charCodeAt(0) - 65;
  if (!(idx >= 0 && idx < n)) return 0;
  return Math.max(0, sectionCap(capacity, idx, n) - (booked || 0) - (held || 0));
}

// After book_group_paid: who got a seat, who already had one, and what to refund.
// Nobody booked means a full refund. Anyone already booked gets their ticket back, and so
// does each typed friend who could not become a separate member (unused).
function planGroupOutcome({ result, buyerId, buyerAmount, friendAmount, paid, unused }) {
  const total = Number(paid) || 0;
  if (!result || !result.ok) return { full: true, refund: total, booked: [], already: [] };
  const booked = (result.booked || []).map((b) => b.member_id);
  const already = result.already || [];
  if (!booked.length) return { full: true, refund: total, booked, already };
  let refund = (Number(unused) || 0) * (Number(friendAmount) || 0);
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

// opts.strict: an admin change to stations or capacity must see every hold or it strands
// them, so a failed read throws instead of counting none.
async function liveHolds(db, sessionIds, opts) {
  if (!sessionIds || !sessionIds.length) return [];
  const { data, error } = await db.from('booking_holds')
    .select('id,session_id,section,kind,spots,claimed,expires_at,cancelled_at')
    .in('session_id', sessionIds).is('cancelled_at', null).gt('expires_at', nowIso());
  if (error && opts && opts.strict) throw new Error('live holds: ' + error.message);
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

// Members for the friends a buyer paid for, made only AFTER the payment succeeded. An
// existing member is linked by exact email; anyone new becomes a guest member
// (createGuestMember: confirmed, passwordless, nothing sent), so they can sign in with that
// email later and find the booking. An email that already has a login but no LFG row (a
// coaching-only account) gets its row added. A friend who cannot be made into a separate
// member (their email is the buyer's, a repeat, or the auth service refuses it) is left
// out and their ticket refunded, rather than holding up the whole group.
// opts.create false: look the friends up only, make nothing.
async function memberIdsForFriends(db, friends, buyerId, opts) {
  const { createGuestMember, authService } = require('./_lib');
  const create = !(opts && opts.create === false);
  const out = [];
  for (const f of friends) {
    try {
      const { data: known } = await db.from('members').select('id').eq('email', f.email).limit(1);
      let id = known && known.length ? known[0].id : null;
      if (!id && create) {
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
    } catch (e) {
      console.warn('[friends] could not make a member for a friend, refunding that ticket:', e && e.message);
    }
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

// Tell the buyer plainly why their card was refunded.
async function refundNotice(db, sessionObj, { memberId, sessionId, reason, group, refunded }) {
  try {
    const { sendRefundNotice } = require('./_email');
    const [sess, who] = await Promise.all([sessionFor(db, sessionId), namesFor(db, [memberId])]);
    const m = who[memberId];
    if (m && m.email) {
      await sendRefundNotice({
        to: m.email, firstName: firstName(m.full_name), sessionDate: sess && sess.session_date,
        amount: (sessionObj.amount_total || 0) / 100, group: !!group, refunded, reason
      });
    }
  } catch (e) { console.warn('[friends] refund email skipped:', e && e.message); }
}

// A card payment that could not become a seat: refund it and tell the buyer plainly.
async function refundUnplaced(db, sessionObj, { memberId, sessionId, reason, group }) {
  const refund = await refundCheckout(db, sessionObj, { amountAed: null, reason });
  await refundNotice(db, sessionObj, { memberId, sessionId, reason, group, refunded: refund.ok });
  return refund;
}

// The checkout hold behind a paid group, and members for the friends typed into it. Runs
// BEFORE claim_fulfilment: up to 7 accounts take a while, and a pass cut short after the
// claim would leave the payment marked paid with no seats. Once the hold is settled the
// friends are only looked up, for their names. A failed read answers { error } so Stripe
// retries; it never turns into a refund.
async function prepareGroup(db, md) {
  const { data: hold, error } = await db.from('booking_holds')
    .select('id,session_id,section,friends,fulfilled_at,outcome,settled_at').eq('id', md.hold_id).maybeSingle();
  if (error) return { error: 'hold read: ' + error.message };
  const typed = hold && Array.isArray(hold.friends) ? hold.friends.filter((f) => f && f.email) : [];
  const members = hold && hold.session_id === md.session_id
    ? await memberIdsForFriends(db, typed, md.member_id, { create: !hold.fulfilled_at }) : [];
  return { hold, typed, members };
}

// Marks a paid group's hold settled. first is true only for the pass that marks it, so the
// refund email and the confirmations go out once.
async function settle(db, hold) {
  if (!hold) return { first: true };
  const { data, error } = await db.from('booking_holds').update({ settled_at: nowIso() })
    .eq('id', hold.id).is('settled_at', null).select('id');
  if (error) return { error: 'settle hold: ' + error.message };
  return { first: !!(data && data.length) };
}

// kind 'group': the buyer plus friends, one station. group is prepareGroup's answer.
// Safe to run again for the same checkout, so a retry after a lost reply finishes the
// refund and the emails instead of stopping at dedup: book_group_paid answers a repeat
// from the outcome stored on the hold, the refund is worked out from that outcome (the
// same amount on every pass, under one Stripe idempotency key per checkout), and the
// emails go out only on the pass that marks the hold settled.
// Returns { refundedAll, buyerRefunded } or { error }. buyerRefunded: the buyer already
// had a seat, so their own ticket went back and their promo must not be redeemed.
async function fulfilGroup(db, sessionObj, md, group) {
  const paid = (sessionObj.amount_total || 0) / 100;
  const buyerAmount = Number(md.buyer_amount) || 0;
  const friendAmount = Number(md.friend_amount) || 0;
  const { hold, typed, members } = group;

  let result = { ok: false, reason: 'no_hold' };
  if (hold && hold.session_id === md.session_id) {
    if (hold.fulfilled_at) result = hold.outcome;
    else {
      const r = await db.rpc('book_group_paid', {
        p_buyer: md.member_id, p_session: md.session_id, p_section: hold.section || md.section || null,
        p_friends: members.map((m) => m.member_id),
        p_buyer_amount: buyerAmount, p_friend_amount: friendAmount, p_hold: hold.id
      });
      if (r.error) return { error: 'book_group_paid: ' + r.error.message };
      result = r.data;
    }
  }

  // Typed friends who could not become members were never sent to book_group_paid. Counted
  // from its answer, so a retry refunds exactly what the first pass did.
  const sent = result && result.ok ? (result.booked || []).length + (result.already || []).length - 1 : typed.length;
  const unused = Math.max(0, typed.length - sent);
  const plan = planGroupOutcome({ result, buyerId: md.member_id, buyerAmount, friendAmount, paid, unused });
  if (plan.full) {
    // Nobody new to book means everyone was already in, not that the Sunday filled up.
    const reason = result && result.ok ? 'already_booked' : (result && result.reason) || 'full';
    console.warn('[fulfill] group not placed, refunding:', reason);
    const refund = await refundCheckout(db, sessionObj, { amountAed: null, reason });
    const done = await settle(db, hold);
    if (done.error) return { error: done.error };
    if (done.first) {
      await refundNotice(db, sessionObj, { memberId: md.member_id, sessionId: md.session_id, reason, group: true, refunded: refund.ok });
    }
    return { refundedAll: true };
  }
  const buyerRefunded = plan.already.indexOf(md.member_id) !== -1;
  let refunded = null;
  if (plan.refund > 0) {
    refunded = await refundCheckout(db, sessionObj, { amountAed: plan.refund, keptAed: paid - plan.refund, reason: 'already_booked' });
  }
  const done = await settle(db, hold);
  if (done.error) return { error: done.error };
  if (!done.first) return { refundedAll: false, buyerRefunded };

  // Confirmations. Friends' names are the ones the buyer typed, never a member's stored
  // name, and a refunded friend ticket is never named.
  try {
    const { sendBookingConfirmation } = require('./_email');
    const sess = await sessionFor(db, md.session_id);
    if (!sess) return { refundedAll: false, buyerRefunded };
    const who = await namesFor(db, [md.member_id]);
    const buyerFirst = firstName(who[md.member_id] && who[md.member_id].full_name) || 'A friend';
    const nameOf = {};
    members.forEach((m) => { nameOf[m.member_id] = m.name; });
    const newFriends = plan.booked.filter((id) => id !== md.member_id);
    const groupNames = newFriends.map((id) => nameOf[id]).filter(Boolean);
    // A buyer who already had a seat keeps it: their email names THEIR station.
    let buyerSection = result.section;
    if (buyerRefunded) {
      const { data: seat } = await db.from('bookings').select('section')
        .eq('member_id', md.member_id).eq('session_id', md.session_id).maybeSingle();
      buyerSection = (seat && seat.section) || null;
    }
    const lines = [];
    if (groupNames.length) lines.push('You booked ' + joinNames(groupNames) + ' on Station ' + result.section + (buyerRefunded ? '.' : ' with you.'));
    if (buyerRefunded) lines.push('You already had your own spot' + (buyerSection ? ' on Station ' + buyerSection : '') + ', so your ticket was refunded.');
    const friendRefund = Math.round((plan.refund - (buyerRefunded ? buyerAmount : 0)) * 100) / 100;
    const friendTickets = plan.already.filter((id) => id !== md.member_id).length + unused;
    if (friendRefund > 0 && friendTickets > 0) {
      lines.push(friendTickets + (friendTickets === 1 ? ' ticket' : ' tickets') + ' could not be used, so ' +
        (refunded && refunded.ok ? 'we refunded AED ' + friendRefund + '.' : 'we will refund AED ' + friendRefund + '.'));
    }
    await sendBookingConfirmation(db, {
      kind: 'single', memberId: md.member_id, sessionId: md.session_id, sessionDate: sess.session_date,
      section: buyerSection, location: sess.location || 'CrossFit Alioth',
      paidAmount: Math.round((paid - plan.refund) * 100) / 100, note: lines.join(' ') || null
    });
    for (const id of newFriends) {
      await sendBookingConfirmation(db, {
        kind: 'single', memberId: id, sessionId: md.session_id, sessionDate: sess.session_date,
        section: result.section, location: sess.location || 'CrossFit Alioth',
        paidAmount: 0, bookedBy: buyerFirst
      });
    }
  } catch (e) { console.warn('[fulfill] group emails skipped:', e && e.message); }
  return { refundedAll: false, buyerRefunded };
}

module.exports = {
  MAX_FRIENDS, STRIPE_EXPIRE_MIN,
  cleanEmail, cleanName, firstName, validToken, cleanFriends, friendPrice, holdState, bookingOpen,
  sectionCap, heldBySession, capacityForBooker, stationRoom, planGroupOutcome, joinNames,
  liveHolds, stationLoad, promoConfigPct, listPrice, memberIdsForFriends,
  refundCheckout, refundUnplaced, prepareGroup, fulfilGroup, sessionFor, namesFor
};
