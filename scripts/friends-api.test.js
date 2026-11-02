// API tests for train-with-a-friend: the real handlers against an in-memory Supabase, a fake
// Stripe and a captured fetch (Resend). No network, no database, no node_modules.
// Run: node --test scripts/friends-api.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const crypto = require('crypto');

Object.assign(process.env, {
  SUPABASE_URL: 'http://fake.supabase', SUPABASE_SERVICE_KEY: 'fake', SUPABASE_SCHEMA: 'public',
  STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PUBLISHABLE_KEY: 'pk_test_fake', RESEND_API_KEY: 'fake', SINGLE_SESSION_PRICE_AED: '99'
});
delete process.env.GHL_LOCATION_API_KEY;
delete process.env.MANYCHAT_API_KEY;

// ------------------------------------------------------------------ in-memory Supabase
let DB = null;
class Query {
  constructor(db, t) { Object.assign(this, { db, t, f: [], mode: 'select', opts: {}, one: null, n: null, ret: false }); }
  rows() { return this.db.tables[this.t] || (this.db.tables[this.t] = []); }
  select(cols, opts) { if (this.mode === 'select') this.opts = opts || {}; else this.ret = true; return this; }
  insert(v) { this.mode = 'insert'; this.v = [].concat(v); return this; }
  update(v) { this.mode = 'update'; this.v = v; return this; }
  upsert(v, o) { this.mode = 'upsert'; this.v = [].concat(v); this.key = ((o && o.onConflict) || 'id').split(','); return this; }
  delete() { this.mode = 'delete'; return this; }
  eq(c, x) { this.f.push((r) => r[c] === x); return this; }
  neq(c, x) { this.f.push((r) => r[c] !== x); return this; }
  in(c, xs) { this.f.push((r) => xs.includes(r[c])); return this; }
  is(c, x) { this.f.push((r) => (x === null ? r[c] == null : r[c] === x)); return this; }
  gt(c, x) { this.f.push((r) => r[c] != null && r[c] > x); return this; }
  gte(c, x) { this.f.push((r) => r[c] != null && r[c] >= x); return this; }
  lt(c, x) { this.f.push((r) => r[c] != null && r[c] < x); return this; }
  lte(c, x) { this.f.push((r) => r[c] != null && r[c] <= x); return this; }
  not(c, op, x) { this.f.push((r) => (op === 'is' && x === null ? r[c] != null : r[c] !== x)); return this; }
  order() { return this; }
  limit(n) { this.n = n; return this; }
  range(a, b) { this.n = b - a + 1; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'one'; return this; }
  then(ok, bad) { return Promise.resolve().then(() => this.run()).then(ok, bad); }
  run() {
    const all = this.rows();
    const hit = all.filter((r) => this.f.every((fn) => fn(r)));
    let out = hit;
    if (this.mode === 'insert') { out = this.v.map((r) => Object.assign({ id: crypto.randomUUID(), created_at: new Date().toISOString() }, r)); all.push(...out); }
    else if (this.mode === 'update') hit.forEach((r) => Object.assign(r, this.v));
    else if (this.mode === 'upsert') {
      out = this.v.map((r) => {
        const ex = all.find((x) => this.key.every((k) => x[k] === r[k]));
        if (ex) return Object.assign(ex, r);
        const nr = Object.assign({ id: crypto.randomUUID() }, r); all.push(nr); return nr;
      });
    } else if (this.mode === 'delete') this.db.tables[this.t] = all.filter((r) => !hit.includes(r));
    if (this.n != null) out = out.slice(0, this.n);
    const count = this.opts.count ? out.length : null;
    if (this.opts.head) return { data: null, error: null, count };
    if (this.one) return out.length ? { data: out[0], error: null } : { data: null, error: this.one === 'one' ? { message: 'no rows' } : null };
    if (this.mode !== 'select' && !this.ret) return { data: null, error: null };
    return { data: out, error: null, count };
  }
}
function newDb({ tables = {}, rpc = {}, tokens = {}, authUsers = [] } = {}) {
  const db = { tables: JSON.parse(JSON.stringify(tables)), rpcCalls: [], authCreated: [] };
  db.from = (t) => new Query(db, t);
  db.rpc = async (name, args) => {
    db.rpcCalls.push({ name, args });
    if (!rpc[name]) return { data: null, error: { message: 'unexpected rpc ' + name } };
    try { return { data: await rpc[name](args, db), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
  };
  db.auth = {
    getUser: async (token) => (tokens[token] ? { data: { user: tokens[token] }, error: null } : { data: { user: null }, error: { message: 'bad token' } }),
    admin: {
      getUserById: async (id) => ({ data: { user: authUsers.find((u) => u.id === id) || null } }),
      createUser: async ({ email, user_metadata }) => {
        if (authUsers.some((u) => u.email === email)) return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } };
        const u = { id: crypto.randomUUID(), email, user_metadata };
        authUsers.push(u); db.authCreated.push(u);
        return { data: { user: u }, error: null };
      },
      generateLink: async () => ({ data: null, error: { message: 'not used in tests' } })
    }
  };
  return db;
}

// ------------------------------------------------------------------ fake Stripe, captured email
const stripeCalls = [];
class FakeStripe {
  constructor() {
    this.checkout = { sessions: {
      create: async (p) => { stripeCalls.push(['create', p]); return { id: 'cs_test_' + stripeCalls.length, client_secret: 'secret' }; },
      expire: async (id) => { stripeCalls.push(['expire', id]); return {}; }
    } };
    this.refunds = { create: async (p, o) => { stripeCalls.push(['refund', p, o]); return { id: 're_' + stripeCalls.length }; } };
  }
}
const realLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return { createClient: () => DB };
  if (request === 'stripe') return FakeStripe;
  return realLoad.apply(this, arguments);
};
const mail = [];
global.fetch = async (url, opts) => {
  if (String(url).includes('api.resend.com')) mail.push(JSON.parse(opts.body));
  return { ok: true, status: 200, json: async () => ({ id: 'em_' + mail.length }) };
};

function call(handler, { method = 'POST', body, query, token } = {}) {
  return new Promise((resolve) => {
    const headers = { host: 'www.lfgdubai.com' };
    if (token) headers.authorization = 'Bearer ' + token;
    const res = {
      statusCode: 200, setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; }
    };
    Promise.resolve(handler({ method, body, query: query || {}, headers }, res)).catch((e) => resolve({ status: 'threw', body: String((e && e.stack) || e) }));
  });
}

const SID = '11111111-1111-4111-8111-111111111111';
const BUYER = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'buyer@example.com', user_metadata: { full_name: 'Bea Buyer' } };
const MEMBER = { id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'member@example.com', user_metadata: {} };
const ADMIN = { id: 'aaaaaaaa-0000-4000-8000-000000000009', email: 'admin@example.com', user_metadata: {} };
const HOLD = 'bbbbbbbb-0000-4000-8000-000000000001';
const future = () => new Date(Date.now() + 3600e3).toISOString();
function tables(extra) {
  return Object.assign({
    sessions: [{ id: SID, session_date: '2099-01-04', start_time: '12:45:00', location: 'TWF', status: 'open', capacity: 32, stations: 4 }],
    members: [
      { id: BUYER.id, email: BUYER.email, full_name: 'Bea Buyer', is_admin: false },
      { id: MEMBER.id, email: MEMBER.email, full_name: 'Mo Member', is_admin: false },
      { id: ADMIN.id, email: ADMIN.email, full_name: 'Ada Admin', is_admin: true }
    ],
    bookings: [], booking_holds: [], payments: [], promo_codes: [],
    event_config: [{ id: 1, bootcamp_promo_enabled: false, bootcamp_promo_pct: 10 }]
  }, extra || {});
}
const groupMeta = (extra) => Object.assign({ kind: 'group', member_id: BUYER.id, session_id: SID, section: 'A', hold_id: HOLD,
  buyer_amount: '99', friend_amount: '89', seats: '3' }, extra || {});

const checkout = require('../api/checkout');
const friendsApi = require('../api/friends');
const L = require('../api/_lib');
const setCapacity = require('../api/admin/set-capacity');
const setSessionStations = require('../api/admin/set-session-stations');

test('1, 4: a group checkout answers the same whoever the friends are, and makes no accounts', async () => {
  const runs = [];
  for (const email of ['member@example.com', 'stranger@example.com']) {
    for (const promo of ['!', undefined]) {
      DB = newDb({
        tables: tables({ bookings: [{ id: 'bk1', member_id: MEMBER.id, session_id: SID, section: 'B', status: 'booked' }] }),
        rpc: { ensure_referral_code: () => ({}),
               create_booking_hold: (a) => ({ ok: true, hold_id: HOLD, token: 't', section: a.p_section, spots: a.p_spots, expires_at: future(), replaced_stripe_session: null }) },
        tokens: { tok: BUYER }, authUsers: [BUYER, MEMBER]
      });
      const r = await call(checkout, { token: 'tok', body: { kind: 'single', session_id: SID, section: 'A', friends: [{ name: 'Pal', email }], promo_code: promo } });
      const hold = DB.rpcCalls.find((c) => c.name === 'create_booking_hold');
      runs.push({ email, promo, r, hold, members: DB.tables.members.length, auth: DB.authCreated.length });
    }
  }
  const pick = (email, promo) => runs.find((x) => x.email === email && x.promo === promo);
  assert.deepEqual(pick('member@example.com', '!').r, pick('stranger@example.com', '!').r, 'bad promo: identical answer');
  assert.equal(pick('member@example.com', '!').r.status, 400);
  for (const email of ['member@example.com', 'stranger@example.com']) {
    const ok = pick(email, undefined);
    assert.equal(ok.r.status, 200, JSON.stringify(ok.r.body));
    assert.equal(ok.r.body.seats, 2);
    assert.deepEqual(ok.hold.args.p_friends, [{ name: 'Pal', email }]);
  }
  runs.forEach((x) => { assert.equal(x.members, 3, 'no member row made before payment'); assert.equal(x.auth, 0, 'no login made before payment'); });
});

test('9: an earlier card form is closed only after the new hold is in', async () => {
  stripeCalls.length = 0;
  const run = (result) => {
    DB = newDb({ tables: tables(), rpc: { ensure_referral_code: () => ({}), create_booking_hold: () => result }, tokens: { tok: BUYER }, authUsers: [BUYER] });
    return call(checkout, { token: 'tok', body: { kind: 'single', session_id: SID, section: 'A', friends: [{ name: 'Pal', email: 'pal@example.com' }] } });
  };
  const refused = await run({ ok: false, section: 'A', room: 1, error: 'Station A has room for 1 of you' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'Station A has room for 1 of you. Pick another station or remove a friend.');
  assert.equal(stripeCalls.filter((c) => c[0] === 'expire').length, 0);
  const good = await run({ ok: true, hold_id: HOLD, token: 't', section: 'A', spots: 2, expires_at: future(), replaced_stripe_session: 'cs_test_old' });
  assert.equal(good.status, 200);
  assert.deepEqual(stripeCalls.filter((c) => c[0] === 'expire').map((c) => c[1]), ['cs_test_old']);
});

test('4, 2: friends become members after payment, and a retry of a booked group does nothing', async () => {
  stripeCalls.length = 0; mail.length = 0;
  let groupCalls = 0;
  DB = newDb({
    tables: tables({
      booking_holds: [{ id: HOLD, session_id: SID, section: 'A', kind: 'checkout', host_member_id: BUYER.id, fulfilled_at: null,
        friends: [{ name: 'Pal', email: 'stranger@example.com' }, { name: 'Mo', email: 'member@example.com' }] }],
      payments: [{ id: 'p1', stripe_session_id: 'cs_test_g', status: 'pending', kind: 'group', amount_aed: 277 }]
    }),
    rpc: {
      claim_fulfilment: () => ({ ok: true, claimed: true }), ensure_referral_code: () => ({}),
      book_group_paid: (a, db) => {
        groupCalls++;
        const hold = db.tables.booking_holds[0];
        hold.fulfilled_at = new Date().toISOString();
        return { ok: true, section: 'A', moved: false, already: [], booked: [a.p_buyer].concat(a.p_friends).map((id) => ({ member_id: id, booking_id: crypto.randomUUID() })) };
      }
    },
    authUsers: [BUYER, MEMBER]
  });
  const session = { id: 'cs_test_g', payment_intent: 'pi_g', amount_total: 27700, metadata: groupMeta() };
  const out = await L.fulfillCheckoutSession(DB, session);
  assert.equal(out.ok, true);
  assert.deepEqual(DB.authCreated.map((u) => u.email), ['stranger@example.com'], 'only the new friend gets a login, after payment');
  const args = DB.rpcCalls.find((c) => c.name === 'book_group_paid').args;
  assert.equal(args.p_friends.length, 2);
  assert.ok(args.p_friends.includes(MEMBER.id), 'an existing member is linked by exact email');
  assert.equal(stripeCalls.filter((c) => c[0] === 'refund').length, 0);
  assert.equal(mail.length, 3, 'buyer + two friends');
  assert.ok(mail.some((m) => /^Bea booked you in/.test(m.subject)));

  // The same checkout again (e.g. the first reply was lost and Stripe retried).
  const again = await L.fulfillCheckoutSession(DB, session);
  assert.equal(again.ok, true);
  assert.equal(groupCalls, 1, 'no second booking call');
  assert.equal(stripeCalls.filter((c) => c[0] === 'refund').length, 0, 'no refund on a retry');
  assert.equal(mail.length, 3, 'no second round of email');
});

test('10: a buyer who already had a seat: their email names their station, no promo redeemed', async () => {
  stripeCalls.length = 0; mail.length = 0;
  DB = newDb({
    tables: tables({
      bookings: [{ id: 'bkb', member_id: BUYER.id, session_id: SID, section: 'C', status: 'booked' }],
      booking_holds: [{ id: HOLD, session_id: SID, section: 'A', kind: 'checkout', host_member_id: BUYER.id, fulfilled_at: null,
        friends: [{ name: 'Mo', email: 'member@example.com' }] }],
      payments: [{ id: 'p2', stripe_session_id: 'cs_test_b', status: 'pending', kind: 'group', amount_aed: 188 }]
    }),
    rpc: {
      claim_fulfilment: () => ({ ok: true, claimed: true }), ensure_referral_code: () => ({}),
      book_group_paid: (a) => ({ ok: true, section: 'A', moved: false, booked: a.p_friends.map((id) => ({ member_id: id })), already: [a.p_buyer] }),
      redeem_promo: () => { throw new Error('the promo must not be redeemed'); }
    },
    authUsers: [BUYER, MEMBER]
  });
  const out = await L.fulfillCheckoutSession(DB, { id: 'cs_test_b', payment_intent: 'pi_b', amount_total: 18800, metadata: groupMeta({ promo_code: 'SAVE10' }) });
  assert.equal(out.ok, true);
  assert.equal(DB.rpcCalls.filter((c) => c.name === 'redeem_promo').length, 0);
  const refund = stripeCalls.find((c) => c[0] === 'refund');
  assert.equal(refund[1].amount, 9900, 'only the buyer\'s own ticket comes back');
  const buyerMail = mail.find((m) => m.to[0] === BUYER.email);
  assert.match(buyerMail.html, /Station <b[^>]*>C<\/b>/);
  assert.match(buyerMail.html, /You already had your own spot on Station C, so your ticket was refunded\./);
  assert.match(buyerMail.html, /You booked Mo on Station A\./);
});

test('7: a Sunday called off while a friend pays: refund, no booking, no "You\'re in"', async () => {
  for (const [fromHold, status] of [[{ ok: false, reason: 'closed' }, 'open'], [{ ok: false, reason: 'station_full' }, 'cancelled']]) {
    stripeCalls.length = 0; mail.length = 0;
    const t = tables({ payments: [{ id: 'p3', stripe_session_id: 'cs_test_s', status: 'pending', kind: 'single', amount_aed: 89 }] });
    t.sessions[0].status = status;
    DB = newDb({
      tables: t,
      rpc: { claim_fulfilment: () => ({ ok: true, claimed: true }), ensure_referral_code: () => ({}),
             book_from_hold: () => fromHold, book_paid: () => { throw new Error('book_paid must not run'); } },
      authUsers: [BUYER]
    });
    const out = await L.fulfillCheckoutSession(DB, { id: 'cs_test_s', payment_intent: 'pi_s', amount_total: 8900,
      metadata: { kind: 'single', member_id: BUYER.id, session_id: SID, section: 'B', hold_id: HOLD } });
    assert.equal(out.ok, true);
    assert.equal(out.refunded, true);
    assert.equal(DB.rpcCalls.filter((c) => c.name === 'book_paid').length, 0);
    const refund = stripeCalls.find((c) => c[0] === 'refund');
    assert.ok(refund && refund[1].amount === undefined, 'a full refund');
    assert.equal(DB.tables.payments[0].status, 'refunded');
    assert.equal(mail.length, 1);
    assert.match(mail[0].subject, /^Refund for your LFG booking/);
    assert.match(mail[0].html, /was called off/);
  }
});

test('6: the invite caps answer the same for a member and a stranger', async () => {
  const hold = { id: HOLD, token: 'c'.repeat(64), session_id: SID, section: 'B', kind: 'invite', host_member_id: BUYER.id, spots: 2, claimed: 0, price_aed: 89, expires_at: future(), cancelled_at: null };
  const answers = {};
  for (const cap of ['day_cap', null]) {
    for (const email of ['member@example.com', 'stranger@example.com']) {
      mail.length = 0;
      DB = newDb({ tables: tables({ booking_holds: [Object.assign({}, hold)] }), tokens: { tok: BUYER }, authUsers: [BUYER, MEMBER],
        rpc: { record_hold_invite: () => (cap ? { ok: false, reason: cap } : { ok: true, repeat: false }) } });
      const r = await call(friendsApi, { token: 'tok', body: { action: 'invite', hold_id: HOLD, email } });
      answers[(cap || 'open') + ':' + email] = { r, mails: mail.length, rpc: DB.rpcCalls.find((c) => c.name === 'record_hold_invite').args };
    }
  }
  assert.deepEqual(answers['day_cap:member@example.com'].r, answers['day_cap:stranger@example.com'].r);
  assert.equal(answers['day_cap:member@example.com'].r.status, 429);
  assert.equal(answers['open:member@example.com'].r.body.message, 'Invite sent.');
  assert.equal(answers['open:member@example.com'].mails, 1);
  assert.equal(answers['open:stranger@example.com'].r.body.message, 'Not on LFG yet. Send them your link.');
  assert.equal(answers['open:stranger@example.com'].mails, 0);
  assert.equal(answers['open:stranger@example.com'].rpc.p_member, null, 'a miss is counted with no member');
  assert.match(answers['open:stranger@example.com'].rpc.p_email_sha256, /^[0-9a-f]{64}$/);
});

test('11: capacity cannot drop below booked plus held; removing a station ends its holds', async () => {
  const live = (section, spots) => ({ id: crypto.randomUUID(), session_id: SID, section, kind: 'invite', host_member_id: BUYER.id, spots, claimed: 0, expires_at: future(), cancelled_at: null });
  DB = newDb({
    tables: tables({ bookings: ['A', 'A', 'B'].map((s, i) => ({ id: 'b' + i, session_id: SID, member_id: 'm' + i, section: s, status: 'booked', booked_at: '2026-11-0' + (i + 1) })),
                     booking_holds: [live('A', 2)] }),
    tokens: { adm: ADMIN }, authUsers: [ADMIN]
  });
  const low = await call(setCapacity, { token: 'adm', body: { session_id: SID, capacity: 4 } });
  assert.equal(low.status, 409);
  assert.equal(low.body.error, "Already 3 booked and 2 held for friends; capacity can't be lower");
  const fine = await call(setCapacity, { token: 'adm', body: { session_id: SID, capacity: 8 } });
  assert.equal(fine.status, 200);

  const keep = live('A', 1), gone = live('D', 2);
  DB = newDb({ tables: tables({ booking_holds: [keep, gone] }), tokens: { adm: ADMIN }, authUsers: [ADMIN] });
  const r = await call(setSessionStations, { token: 'adm', body: { session_id: SID, stations: 3 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.released_holds, 1);
  assert.ok(DB.tables.booking_holds.find((h) => h.id === gone.id).cancelled_at, 'the hold on D ended');
  assert.equal(DB.tables.booking_holds.find((h) => h.id === keep.id).cancelled_at, null, 'the hold on A stays');
});
