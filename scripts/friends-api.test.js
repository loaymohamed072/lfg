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
// Like PostgREST, a select returns only the columns it names (a column the code forgot to
// select reads as undefined, as it would in production). db.fail['table:mode'] makes that
// query answer with an error instead, before it touches anything.
let DB = null;
class Query {
  constructor(db, t) { Object.assign(this, { db, t, f: [], mode: 'select', opts: {}, one: null, n: null, ret: false, cols: null }); }
  rows() { return this.db.tables[this.t] || (this.db.tables[this.t] = []); }
  select(cols, opts) { this.cols = cols || null; if (this.mode === 'select') this.opts = opts || {}; else this.ret = true; return this; }
  pick(rows) {
    // Embedded resources (members(email)) are not modelled: those rows pass through whole.
    if (!this.cols || /[(*]/.test(this.cols)) return rows;
    const keys = this.cols.split(',').map((c) => c.trim()).filter(Boolean);
    return rows.map((r) => { const o = {}; keys.forEach((k) => { o[k] = r[k] === undefined ? null : r[k]; }); return o; });
  }
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
    const failed = this.db.fail[this.t + ':' + this.mode];
    if (failed) return { data: null, error: { message: failed }, count: null };
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
    out = this.pick(out);
    const count = this.opts.count ? out.length : null;
    if (this.opts.head) return { data: null, error: null, count };
    if (this.one) return out.length ? { data: out[0], error: null } : { data: null, error: this.one === 'one' ? { message: 'no rows' } : null };
    if (this.mode !== 'select' && !this.ret) return { data: null, error: null };
    return { data: out, error: null, count };
  }
}
function newDb({ tables = {}, rpc = {}, tokens = {}, authUsers = [], fail = {} } = {}) {
  const db = { tables: JSON.parse(JSON.stringify(tables)), rpcCalls: [], authCreated: [], fail, log: [] };
  db.from = (t) => new Query(db, t);
  db.rpc = async (name, args) => {
    db.rpcCalls.push({ name, args }); db.log.push('rpc:' + name);
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
        authUsers.push(u); db.authCreated.push(u); db.log.push('auth:' + email);
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
// book_group_paid as the migration writes it: books whoever is not in yet on station A,
// stores the answer on the hold, and answers a repeat from that stored outcome.
function groupPaid(a, db) {
  const hold = db.tables.booking_holds.find((h) => h.id === a.p_hold);
  if (hold.fulfilled_at) return Object.assign({}, hold.outcome, { dedup: true });
  const inAlready = (id) => db.tables.bookings.some((b) => b.member_id === id && b.session_id === a.p_session && b.status === 'booked');
  const people = [a.p_buyer].concat(a.p_friends.filter((id) => id !== a.p_buyer));
  const already = people.filter(inAlready);
  const booked = people.filter((id) => !inAlready(id)).map((id) => {
    const b = { id: crypto.randomUUID(), member_id: id, session_id: a.p_session, section: 'A', status: 'booked' };
    db.tables.bookings.push(b);
    return { member_id: id, booking_id: b.id };
  });
  const out = { ok: true, section: booked.length ? 'A' : null, moved: false, booked, already };
  Object.assign(hold, { fulfilled_at: new Date().toISOString(), outcome: out });
  return out;
}
// claim_fulfilment as production has it: pending becomes paid once; after that, already processed.
function claimOnce(a, db) {
  const p = db.tables.payments.find((x) => x.stripe_session_id === a.p_session_id);
  if (!p || p.status !== 'pending') return { ok: false, reason: 'already_processed', status: p && p.status };
  p.status = 'paid';
  return { ok: true, claimed: true };
}
const groupHold = (friends, extra) => Object.assign({ id: HOLD, session_id: SID, section: 'A', kind: 'checkout', host_member_id: BUYER.id,
  fulfilled_at: null, outcome: null, settled_at: null, friends }, extra || {});
const refunds = () => stripeCalls.filter((c) => c[0] === 'refund');

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
      book_group_paid: (a, db) => { groupCalls++; return groupPaid(a, db); }
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

// Loay, 4 Nov 2026: 150 on a 6-station Sunday was saved as 156. The typed number now rounds
// DOWN to an even split (partners train in pairs), unless that would leave someone booked
// without a place; then it goes in as typed and the database rounds it up, as before.
test('11b: a typed capacity rounds down to an even split across the stations', async () => {
  const six = (extra) => tables(Object.assign({ sessions: [{ id: SID, session_date: '2099-01-04', start_time: '12:45:00',
    location: 'TWF', status: 'open', capacity: 36, max_capacity: 96, stations: 6 }] }, extra));
  DB = newDb({ tables: six(), tokens: { adm: ADMIN }, authUsers: [ADMIN] });
  const r = await call(setCapacity, { token: 'adm', body: { session_id: SID, capacity: 150 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.capacity, 144);
  assert.equal(DB.tables.sessions[0].capacity, 144, '24 a station');
  assert.equal(DB.tables.sessions[0].max_capacity, 144);
  const even = await call(setCapacity, { token: 'adm', body: { session_id: SID, capacity: 120 } });
  assert.equal(even.body.capacity, 120, 'an even split is saved as typed');

  const thirteen = Array.from({ length: 13 }, (_, i) => ({ id: 'b' + i, session_id: SID, member_id: 'm' + i,
    section: 'ABCDEF'[i % 6], status: 'booked', booked_at: '2026-11-01' }));
  DB = newDb({ tables: six({ bookings: thirteen }), tokens: { adm: ADMIN }, authUsers: [ADMIN] });
  const tight = await call(setCapacity, { token: 'adm', body: { session_id: SID, capacity: 14 } });
  assert.equal(tight.status, 200, JSON.stringify(tight.body));
  assert.equal(DB.tables.sessions[0].capacity, 14, '12 would strand a booked member');
});

// ------------------------------------------------------------------ review fixes, 2026-11-02 (A to F)
const sessionsApi = require('../api/sessions');
const liveHold = (section, extra) => Object.assign({ id: crypto.randomUUID(), session_id: SID, section, kind: 'invite', host_member_id: BUYER.id,
  spots: 2, claimed: 0, expires_at: future(), cancelled_at: null }, extra || {});

test('A: the fake database returns only the columns a select names', async () => {
  DB = newDb({ tables: { t: [{ id: 1, a: 2, b: 3 }] } });
  assert.deepEqual((await DB.from('t').select('id, a')).data, [{ id: 1, a: 2 }]);
  assert.deepEqual((await DB.from('t').select('*')).data, [{ id: 1, a: 2, b: 3 }]);
});

test('A: a failed hold read or release leaves stations, bookings and holds as they were', async () => {
  for (const fail of [{ 'booking_holds:select': 'connection reset' }, { 'booking_holds:update': 'connection reset' }]) {
    const what = Object.keys(fail)[0];
    DB = newDb({
      tables: tables({ bookings: [{ id: 'bd', session_id: SID, member_id: MEMBER.id, section: 'D', status: 'booked', booked_at: '2026-11-01' }],
                       booking_holds: [liveHold('D')] }),
      tokens: { adm: ADMIN }, authUsers: [ADMIN], fail
    });
    const r = await call(setSessionStations, { token: 'adm', body: { session_id: SID, stations: 3 } });
    assert.equal(r.status, 500, what);
    assert.equal(DB.tables.sessions[0].stations, 4, what + ': stations unchanged');
    assert.equal(DB.tables.bookings[0].section, 'D', what + ': nobody moved');
    assert.equal(DB.tables.booking_holds[0].cancelled_at, null, what + ': the hold is untouched');
  }
  // Nor is capacity set below booked plus held when the holds could not be read.
  DB = newDb({ tables: tables({ booking_holds: [liveHold('A')] }), tokens: { adm: ADMIN }, authUsers: [ADMIN],
    fail: { 'booking_holds:select': 'connection reset' } });
  const cap = await call(setCapacity, { token: 'adm', body: { session_id: SID, capacity: 4 } });
  assert.equal(cap.status, 500);
  assert.equal(DB.tables.sessions[0].capacity, 32);
});

test('B: a retry after a lost reply finishes the refund and the emails, once', async () => {
  stripeCalls.length = 0; mail.length = 0;
  let lose = true;
  DB = newDb({
    tables: tables({
      bookings: [{ id: 'bkm', member_id: MEMBER.id, session_id: SID, section: 'B', status: 'booked' }],
      booking_holds: [groupHold([{ name: 'Pal', email: 'stranger@example.com' }, { name: 'Mo', email: 'member@example.com' }])],
      payments: [{ id: 'p5', stripe_session_id: 'cs_test_r', status: 'pending', kind: 'group', amount_aed: 277 }]
    }),
    rpc: {
      claim_fulfilment: claimOnce, ensure_referral_code: () => ({}),
      // The booking commits, then its reply is lost on the way back.
      book_group_paid: (a, db) => { const out = groupPaid(a, db); if (lose) { lose = false; throw new Error('fetch failed'); } return out; }
    },
    authUsers: [BUYER, MEMBER]
  });
  const session = { id: 'cs_test_r', payment_intent: 'pi_r', amount_total: 27700, metadata: groupMeta() };
  const first = await L.fulfillCheckoutSession(DB, session);
  assert.equal(first.ok, false, 'the lost reply fails the webhook, so Stripe retries');
  assert.equal(DB.tables.payments[0].status, 'pending');
  assert.equal(refunds().length + mail.length, 0);

  const retry = await L.fulfillCheckoutSession(DB, session);
  assert.equal(retry.ok, true);
  assert.equal(DB.rpcCalls.filter((c) => c.name === 'book_group_paid').length, 1, 'booked once');
  assert.equal(refunds().length, 1, "Mo already had a spot: his ticket comes back");
  assert.equal(refunds()[0][1].amount, 8900);
  assert.equal(refunds()[0][2].idempotencyKey, 'lfg-refund-cs_test_r');
  assert.deepEqual(mail.map((m) => m.to[0]).sort(), ['buyer@example.com', 'stranger@example.com']);
  assert.match(mail.find((m) => m.to[0] === BUYER.email).html, /1 ticket could not be used, so we refunded AED 89\./);

  // Stripe delivers the same event again: claimed and settled, so nothing more happens.
  const again = await L.fulfillCheckoutSession(DB, session);
  assert.equal(again.ok, true);
  assert.equal(refunds().length, 1, 'no second refund');
  assert.equal(mail.length, 2, 'no second round of email');
});

test('B, D: a pass cut short after the claim is finished by the next delivery, once', async () => {
  // Cut short before booking (the payment says paid, the hold is undecided), and after it.
  for (const decided of [false, true]) {
    stripeCalls.length = 0; mail.length = 0;
    const hold = groupHold([{ name: 'Mo', email: 'member@example.com' }]);
    const bookings = [];
    if (decided) {
      bookings.push({ id: 'bb', member_id: BUYER.id, session_id: SID, section: 'A', status: 'booked' },
                    { id: 'bm', member_id: MEMBER.id, session_id: SID, section: 'B', status: 'booked' });
      Object.assign(hold, { fulfilled_at: '2026-11-02T10:00:00Z',
        outcome: { ok: true, section: 'A', moved: false, booked: [{ member_id: BUYER.id, booking_id: 'bb' }], already: [MEMBER.id] } });
    }
    DB = newDb({
      tables: tables({ bookings, booking_holds: [hold],
        payments: [{ id: 'p6', stripe_session_id: 'cs_test_k', status: 'paid', kind: 'group', amount_aed: 188 }] }),
      rpc: { claim_fulfilment: claimOnce, ensure_referral_code: () => ({}), book_group_paid: groupPaid },
      authUsers: [BUYER, MEMBER]
    });
    const session = { id: 'cs_test_k', payment_intent: 'pi_k', amount_total: 18800, metadata: groupMeta() };
    const out = await L.fulfillCheckoutSession(DB, session);
    assert.equal(out.ok, true);
    if (decided) {
      assert.equal(refunds().length, 1, 'decided: the refund is finished');
      assert.equal(refunds()[0][1].amount, 8900);
      assert.deepEqual(mail.map((m) => m.to[0]), ['buyer@example.com']);
    } else {
      assert.ok(DB.tables.bookings.some((b) => b.member_id === BUYER.id), 'undecided: the group is booked');
      assert.ok(DB.tables.bookings.some((b) => b.member_id === MEMBER.id));
      assert.equal(refunds().length, 0);
      assert.deepEqual(mail.map((m) => m.to[0]).sort(), ['buyer@example.com', 'member@example.com']);
    }
    const sent = mail.length;
    await L.fulfillCheckoutSession(DB, session);
    assert.equal(mail.length, sent, 'once');
    assert.equal(refunds().length, decided ? 1 : 0, 'once');
  }
});

test('B: a failed hold read fails the webhook and refunds nothing', async () => {
  const booked = { fulfilled_at: '2026-11-02T10:00:00Z', outcome: { ok: true, section: 'A', moved: false, booked: [{ member_id: BUYER.id }], already: [] } };
  for (const hold of [groupHold([{ name: 'Pal', email: 'stranger@example.com' }]), groupHold([], booked)]) {
    stripeCalls.length = 0; mail.length = 0;
    DB = newDb({
      tables: tables({ booking_holds: [hold], payments: [{ id: 'p7', stripe_session_id: 'cs_test_f', status: 'pending', kind: 'group', amount_aed: 188 }] }),
      rpc: { claim_fulfilment: claimOnce, ensure_referral_code: () => ({}), book_group_paid: groupPaid },
      authUsers: [BUYER], fail: { 'booking_holds:select': 'connection reset' }
    });
    const out = await L.fulfillCheckoutSession(DB, { id: 'cs_test_f', payment_intent: 'pi_f', amount_total: 18800, metadata: groupMeta() });
    assert.equal(out.ok, false);
    assert.match(out.error, /hold read/);
    assert.equal(refunds().length, 0, 'never a refund');
    assert.equal(mail.length, 0);
    assert.equal(DB.tables.payments[0].status, 'pending', 'still pending, so the retry runs it again');
  }
});

test('C: held spots alone never sell out a Sunday that can still grow', async () => {
  // Production settings: capacity 32, bump 10. 24 booked plus four 2-person checkouts.
  const booked = Array.from({ length: 24 }, (_, i) => ({ id: 'cb' + i, session_id: SID, member_id: 'm' + i, section: 'ABCD'[i % 4], status: 'booked' }));
  const held = ['A', 'B', 'C', 'D'].map((s) => liveHold(s, { kind: 'checkout', host_member_id: 'buyer-' + s }));
  for (const max of [96, 32]) {
    const t = tables({ bookings: booked, booking_holds: held });
    Object.assign(t.sessions[0], { max_capacity: max, bump_increment: 10 });
    DB = newDb({ tables: t, rpc: { ensure_upcoming_sundays: () => null }, tokens: { tok: BUYER }, authUsers: [BUYER] });
    const sun = (await call(sessionsApi, { method: 'GET' })).body.sessions.find((s) => s.id === SID);
    const card = await call(checkout, { token: 'tok', body: { kind: 'single', session_id: SID, section: 'A' } });
    if (max === 96) {
      assert.equal(sun.sold_out, false, 'the next booking grows it: 32 + 10, stored as 48');
      assert.equal(sun.spots_left, 16);
      assert.ok(sun.sections.every((x) => x.spots_now > 0), JSON.stringify(sun.sections));
      assert.equal(card.status, 200, JSON.stringify(card.body));
    } else {
      assert.equal(sun.sold_out, true, 'at max_capacity it is full');
      assert.equal(card.status, 409);
    }
  }
});

// Loay, 4 Nov 2026: "station d and f need more people yet u open 1 for e". 8 Nov had
// A17 B16 C17 D14 E16 F14 booked while friends' links held A3 B4 C1 D4 E1 F4. Counting a held
// spot as a person made D and F read 18 and E 17, so only E opened, for one booking.
test('4 Nov: the stations with the fewest people open; a held spot only fills its cap', async () => {
  const people = { A: 17, B: 16, C: 17, D: 14, E: 16, F: 14 };
  const held = { A: [1, 1, 1], B: [2, 2], C: [1], D: [2, 2], E: [1], F: [2, 1, 1] };
  const bookings = [];
  Object.keys(people).forEach((s) => {
    for (let i = 0; i < people[s]; i++) bookings.push({ id: s + i, session_id: SID, member_id: s + i, section: s, status: 'booked' });
  });
  const holds = [].concat(...Object.keys(held).map((s) => held[s].map((spots) => liveHold(s, { spots }))));
  const t = tables({ bookings, booking_holds: holds });
  Object.assign(t.sessions[0], { capacity: 144, max_capacity: 144, stations: 6 });
  DB = newDb({ tables: t, rpc: { ensure_upcoming_sundays: () => null } });
  const sun = (await call(sessionsApi, { method: 'GET' })).body.sessions.find((s) => s.id === SID);
  assert.deepEqual(Object.fromEntries(sun.sections.map((x) => [x.label, x.spots_now])), { A: 0, B: 0, C: 0, D: 2, E: 0, F: 2 });
  assert.deepEqual(sun.sections.map((x) => x.spots_left), [4, 4, 6, 6, 7, 6], 'a held spot still fills its station');
  assert.equal(sun.spots_left, 33);
});

test('D: friends get their accounts before the payment is claimed', async () => {
  stripeCalls.length = 0; mail.length = 0;
  DB = newDb({
    tables: tables({ booking_holds: [groupHold([{ name: 'Pal', email: 'stranger@example.com' }])],
      payments: [{ id: 'p8', stripe_session_id: 'cs_test_d', status: 'pending', kind: 'group', amount_aed: 188 }] }),
    rpc: { claim_fulfilment: claimOnce, ensure_referral_code: () => ({}), book_group_paid: groupPaid },
    authUsers: [BUYER]
  });
  const out = await L.fulfillCheckoutSession(DB, { id: 'cs_test_d', payment_intent: 'pi_d', amount_total: 18800, metadata: groupMeta() });
  assert.equal(out.ok, true);
  const made = DB.log.indexOf('auth:stranger@example.com');
  assert.ok(made !== -1 && made < DB.log.indexOf('rpc:claim_fulfilment'), DB.log.join(' '));
});

test('D: the webhook has time to finish a group', () => {
  const fn = require('../vercel.json').functions['api/stripe-webhook.js'] || {};
  assert.ok(fn.maxDuration >= 60, 'maxDuration ' + fn.maxDuration);
});

test('F: when everyone was already booked, the refund email says so', async () => {
  stripeCalls.length = 0; mail.length = 0;
  DB = newDb({
    tables: tables({
      bookings: [{ id: 'b1', member_id: BUYER.id, session_id: SID, section: 'C', status: 'booked' },
                 { id: 'b2', member_id: MEMBER.id, session_id: SID, section: 'B', status: 'booked' }],
      booking_holds: [groupHold([{ name: 'Mo', email: 'member@example.com' }])],
      payments: [{ id: 'p9', stripe_session_id: 'cs_test_a', status: 'pending', kind: 'group', amount_aed: 188 }]
    }),
    rpc: { claim_fulfilment: claimOnce, ensure_referral_code: () => ({}), book_group_paid: groupPaid },
    authUsers: [BUYER, MEMBER]
  });
  const out = await L.fulfillCheckoutSession(DB, { id: 'cs_test_a', payment_intent: 'pi_a', amount_total: 18800, metadata: groupMeta() });
  assert.equal(out.refunded, true);
  assert.equal(refunds().length, 1);
  assert.equal(refunds()[0][1].amount, undefined, 'a full refund');
  assert.equal(mail.length, 1);
  assert.match(mail[0].html, /Everyone in your group was already booked for/);
  assert.doesNotMatch(mail[0].html, /filled up/);
});

// ------------------------------------------------------------------ early-week discount: singles only
// Loay, 2 Nov 2026: Monday to Wednesday (Dubai) a single is 10% off; a pack is list price
// every day, and a promo code on a pack is weighed against that list price.
const validatePromo = require('../api/validate-promo');
const MONDAY_NOON_DUBAI = Date.parse('2026-11-02T08:00:00Z');
const PACK4 = { id: 4, name: '4 Credits', sessions_count: 4, price_aed: 368, validity_months: 2, active: true };
function earlyWeekDb(extra) {
  return newDb({
    tables: tables(Object.assign({
      event_config: [{ id: 1, bootcamp_promo_enabled: true, bootcamp_promo_pct: 10 }],
      packages: [PACK4]
    }, extra || {})),
    rpc: { ensure_referral_code: () => ({}) },
    tokens: { tok: BUYER }, authUsers: [BUYER]
  });
}
const lastCharge = () => {
  const p = stripeCalls.filter((c) => c[0] === 'create').pop()[1];
  return { aed: p.line_items[0].price_data.unit_amount / 100, note: p.line_items[0].price_data.product_data.description };
};

test('early week: on a Monday a single is 10% off and a pack is its list price', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: MONDAY_NOON_DUBAI });
  stripeCalls.length = 0;
  DB = earlyWeekDb();
  const pack = await call(checkout, { token: 'tok', body: { kind: 'package', package_id: 4 } });
  assert.equal(pack.status, 200, JSON.stringify(pack.body));
  assert.equal(lastCharge().aed, 368);
  assert.doesNotMatch(lastCharge().note, /% off/);
  const single = await call(checkout, { token: 'tok', body: { kind: 'single', session_id: SID, section: 'A' } });
  assert.equal(single.status, 200, JSON.stringify(single.body));
  assert.equal(lastCharge().aed, 89);
  assert.match(lastCharge().note, /10% off, booked Monday to Wednesday/);
});

test('early week: a code on a pack is weighed against the list price, on a single against the 10% off', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: MONDAY_NOON_DUBAI });
  stripeCalls.length = 0;
  DB = earlyWeekDb({ promo_codes: [{ code: 'FIVE', kind: 'percent', value: 5, active: true, expires_at: null,
    max_redemptions: null, times_redeemed: 0, email_lock: null, referral_owner_id: null }] });
  const onPack = await call(validatePromo, { token: 'tok', body: { kind: 'package', package_id: 4, code: 'FIVE' } });
  assert.equal(onPack.body.ok, true, JSON.stringify(onPack.body));
  assert.equal(onPack.body.final_amount, 349.6);
  const onSingle = await call(validatePromo, { token: 'tok', body: { kind: 'single', code: 'FIVE' } });
  assert.equal(onSingle.body.ok, false);
  assert.match(onSingle.body.error, /10% off is already on the price/);
  const packWithCode = await call(checkout, { token: 'tok', body: { kind: 'package', package_id: 4, promo_code: 'FIVE' } });
  assert.equal(packWithCode.status, 200, JSON.stringify(packWithCode.body));
  assert.equal(lastCharge().aed, 349.6);
});

// ------------------------------------------------------------------ free Sunday
// Loay, 2 Nov 2026: the admin makes one Sunday free. /api/book books it with book_free (no
// credit), every card path refuses it, a friend's invite joins it free, and only an admin can
// flip it, only on a Sunday still to come.
const book = require('../api/book');
const setSessionFree = require('../api/admin/set-session-free');
const freeSessions = () => [{ id: SID, session_date: '2099-01-04', start_time: '12:45:00', location: 'TWF', status: 'open', capacity: 32, stations: 4, is_free: true }];
const bookingRpcs = () => DB.rpcCalls.map((c) => c.name).filter((n) => n !== 'ensure_referral_code');

test('free Sunday: /api/book books it with book_free, and the email promises no credit back', async () => {
  mail.length = 0;
  DB = newDb({
    tables: tables({ sessions: freeSessions() }),
    rpc: { ensure_referral_code: () => ({}), book_free: () => ({ ok: true, booking_id: 'bk-free', section: 'A', credits_left: 2, free: true }) },
    tokens: { tok: BUYER }, authUsers: [BUYER]
  });
  const r = await call(book, { token: 'tok', body: { session_id: SID, section: 'A' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.free, true);
  assert.deepEqual(bookingRpcs(), ['book_free']);
  assert.equal(mail.length, 1);
  assert.match(mail[0].html, /Free Sunday · nothing to pay/);
  assert.match(mail[0].html, /so someone else can take it/);
  assert.doesNotMatch(mail[0].html, /credit goes straight back/);
});

test('free Sunday: a normal Sunday still spends a credit', async () => {
  DB = newDb({
    tables: tables(),
    rpc: { ensure_referral_code: () => ({}), book_with_credit: () => ({ ok: true, booking_id: 'bk-c', section: 'A', credits_left: 1 }) },
    tokens: { tok: BUYER }, authUsers: [BUYER]
  });
  const r = await call(book, { token: 'tok', body: { session_id: SID, section: 'A' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(bookingRpcs(), ['book_with_credit']);
});

test('free Sunday: no card path opens Stripe for it', async () => {
  stripeCalls.length = 0;
  DB = newDb({ tables: tables({ sessions: freeSessions() }), rpc: { ensure_referral_code: () => ({}) }, tokens: { tok: BUYER }, authUsers: [BUYER] });
  const single = await call(checkout, { token: 'tok', body: { kind: 'single', session_id: SID, section: 'A' } });
  const group = await call(checkout, { token: 'tok', body: { kind: 'single', session_id: SID, section: 'A', friends: [{ name: 'Pal', email: 'pal@example.com' }] } });
  for (const r of [single, group]) {
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.free, true);
  }
  assert.equal(stripeCalls.filter((c) => c[0] === 'create').length, 0);
  assert.equal(DB.tables.payments.length, 0);
  assert.equal(DB.rpcCalls.filter((c) => c.name === 'create_booking_hold').length, 0);
});

test('free Sunday: a friend joins from the invite free, and paying for it by card is refused', async () => {
  stripeCalls.length = 0; mail.length = 0;
  const TOKEN = 'f'.repeat(64);
  const hold = { id: HOLD, session_id: SID, section: 'B', kind: 'invite', token: TOKEN, host_member_id: BUYER.id, spots: 2, claimed: 0,
    price_aed: 0, expires_at: future(), cancelled_at: null };
  DB = newDb({
    tables: tables({ sessions: freeSessions(), booking_holds: [hold] }),
    rpc: { ensure_referral_code: () => ({}),
           book_from_hold: () => ({ ok: true, booking_id: 'bk-j', section: 'B', session_id: SID, host_member_id: BUYER.id, via: 'hold', credits_left: 0 }) },
    tokens: { tok: MEMBER }, authUsers: [BUYER, MEMBER]
  });
  const card = await call(checkout, { token: 'tok', body: { kind: 'single', join: TOKEN } });
  assert.equal(card.status, 409, JSON.stringify(card.body));
  assert.equal(card.body.free, true);
  const r = await call(book, { token: 'tok', body: { join: TOKEN } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(DB.rpcCalls.find((x) => x.name === 'book_from_hold').args.p_payment, 'free');
  assert.equal(stripeCalls.filter((x) => x[0] === 'create').length, 0);
  assert.match(mail[0].html, /Free Sunday · nothing to pay/);
});

test('free Sunday: only an admin can flip it, and only on a Sunday still to come', async () => {
  const past = { id: 'cccccccc-0000-4000-8000-000000000001', session_date: '2020-01-05', start_time: '12:45:00', status: 'open', is_free: false };
  DB = newDb({
    tables: tables({ sessions: [Object.assign({}, freeSessions()[0], { is_free: false }), past] }),
    tokens: { mem: MEMBER, adm: ADMIN }, authUsers: [MEMBER, ADMIN]
  });
  const denied = await call(setSessionFree, { token: 'mem', body: { sessions: [{ session_id: SID, is_free: true }] } });
  assert.equal(denied.status, 403);
  const bad = await call(setSessionFree, { token: 'adm', body: { sessions: [{ session_id: SID, is_free: 'yes' }] } });
  assert.equal(bad.status, 400);
  const ok = await call(setSessionFree, { token: 'adm', body: { sessions: [{ session_id: SID, is_free: true }, { session_id: past.id, is_free: true }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.applied, 1);
  assert.equal(DB.tables.sessions.find((s) => s.id === SID).is_free, true);
  assert.equal(DB.tables.sessions.find((s) => s.id === past.id).is_free, false);
});
