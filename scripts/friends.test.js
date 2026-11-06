// Unit tests for train-with-a-friend pure helpers. Run: node --test scripts/friends.test.js
// No network, no database, no node_modules: api/_friends.js keeps its requires lazy and
// app-assets/lfg-friends.js exports its pure helpers when loaded by Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../api/_friends');
const C = require('../app-assets/lfg-friends');

const NOW = Date.parse('2026-11-04T08:00:00Z'); // a Wednesday morning in Dubai

test('friendPrice: a friend pays the normal ticket, today', () => {
  // Thursday to Sunday, no early-week discount running.
  assert.equal(F.friendPrice({ list: 99, nowPct: 0, cfgPct: 10, hostPaid: 99 }), 99);
  // Host paid the Monday-Wednesday price by card: the friend keeps it later in the week.
  assert.equal(F.friendPrice({ list: 99, nowPct: 0, cfgPct: 10, hostPaid: 89 }), 89);
  // Host booked with a credit: today's price.
  assert.equal(F.friendPrice({ list: 99, nowPct: 0, cfgPct: 10, hostPaid: 0 }), 99);
  assert.equal(F.friendPrice({ list: 99, nowPct: 10, cfgPct: 10, hostPaid: 0 }), 89);
  // A host's promo code never carries over.
  assert.equal(F.friendPrice({ list: 99, nowPct: 0, cfgPct: 10, hostPaid: 50 }), 99);
  // Never more than today's price.
  assert.equal(F.friendPrice({ list: 99, nowPct: 10, cfgPct: 10, hostPaid: 99 }), 89);
  // Early-week switched off entirely.
  assert.equal(F.friendPrice({ list: 99, nowPct: 0, cfgPct: 0, hostPaid: 89 }), 99);
  // A different configured percent rounds the same way the widget does.
  assert.equal(F.friendPrice({ list: 99, nowPct: 0, cfgPct: 15, hostPaid: 84 }), 84);
});

test('cleanFriends: name and email each, no repeats, never the buyer', () => {
  assert.deepEqual(F.cleanFriends(null, 'me@x.com'), { ok: true, friends: [] });
  assert.equal(F.cleanFriends('nope', 'me@x.com').ok, false);
  const ok = F.cleanFriends([{ name: '  Ali   Hassan ', email: ' ALI@Mail.com ' }, { name: '', email: '' }], 'me@x.com');
  assert.deepEqual(ok, { ok: true, friends: [{ name: 'Ali Hassan', email: 'ali@mail.com' }] });
  assert.equal(F.cleanFriends([{ name: 'Ali', email: '' }]).error, 'Check the email for Ali.');
  assert.equal(F.cleanFriends([{ name: '', email: 'a@b.co' }]).error, 'Add a name for each friend.');
  assert.match(F.cleanFriends([{ name: 'Me', email: 'ME@x.com' }], 'me@x.com').error, /your own email/);
  assert.match(F.cleanFriends([{ name: 'A', email: 'a@b.co' }, { name: 'B', email: 'A@b.co' }]).error, /twice/);
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: 'F' + i, email: 'f' + i + '@x.com' }));
  assert.equal(F.cleanFriends(eight).error, 'You can bring up to 7 friends.');
  assert.equal(F.cleanFriends(eight.slice(0, 7)).friends.length, 7);
  assert.equal(F.cleanFriends([{ name: 'x'.repeat(200), email: 'a@b.co' }]).friends[0].name.length, 80);
});

test('holdState and bookingOpen', () => {
  const live = { spots: 3, claimed: 1, expires_at: new Date(NOW + 3600e3).toISOString(), cancelled_at: null };
  assert.equal(F.holdState(live, NOW), 'active');
  assert.equal(F.holdState({ ...live, claimed: 3 }, NOW), 'full');
  assert.equal(F.holdState({ ...live, expires_at: new Date(NOW).toISOString() }, NOW), 'expired');
  assert.equal(F.holdState({ ...live, cancelled_at: new Date(NOW).toISOString() }, NOW), 'cancelled');
  assert.equal(F.holdState(null, NOW), 'invalid');

  const sun = { status: 'open', session_date: '2026-11-08', start_time: '12:45:00' };
  assert.equal(F.bookingOpen(sun, NOW), true);
  // 12:45 Dubai = 08:45Z; open until 135 minutes later (11:00Z).
  assert.equal(F.bookingOpen(sun, Date.parse('2026-11-08T11:00:00Z')), true);
  assert.equal(F.bookingOpen(sun, Date.parse('2026-11-08T11:00:01Z')), false);
  assert.equal(F.bookingOpen({ ...sun, status: 'closed' }, NOW), false);
  assert.equal(F.bookingOpen(null, NOW), false);
});

test('heldBySession counts live holds only, per station', () => {
  const fut = new Date(NOW + 60e3).toISOString(), past = new Date(NOW - 60e3).toISOString();
  const rows = [
    { session_id: 's1', section: 'A', spots: 3, claimed: 1, expires_at: fut, cancelled_at: null },
    { session_id: 's1', section: 'A', spots: 2, claimed: 0, expires_at: fut, cancelled_at: null },
    { session_id: 's1', section: 'B', spots: 2, claimed: 2, expires_at: fut, cancelled_at: null },   // all claimed
    { session_id: 's1', section: 'C', spots: 4, claimed: 0, expires_at: past, cancelled_at: null },  // expired
    { session_id: 's2', section: 'D', spots: 1, claimed: 0, expires_at: fut, cancelled_at: fut },    // cancelled
    { session_id: 's2', section: 'C', spots: 5, claimed: 1, expires_at: fut, cancelled_at: null }
  ];
  assert.deepEqual(F.heldBySession(rows, NOW), {
    s1: { total: 4, sections: { A: 4 } },
    s2: { total: 4, sections: { C: 4 } }
  });
  assert.deepEqual(F.heldBySession(null, NOW), {});
});

test('stationRoom matches section_cap', () => {
  assert.equal(F.stationRoom(32, 4, 'A', 3, 2), 3);
  assert.equal(F.stationRoom(32, 4, 'D', 8, 0), 0);
  assert.equal(F.stationRoom(32, 4, 'D', 7, 3), 0);   // never negative
  assert.equal(F.stationRoom(30, 4, 'A', 0, 0), 8);   // uneven caps: 8,8,7,7
  assert.equal(F.stationRoom(30, 4, 'D', 0, 0), 7);
  assert.equal(F.stationRoom(32, 4, 'E', 0, 0), 0);   // no such station
});

test('planGroupOutcome: refund nobody, part, or all', () => {
  const base = { buyerId: 'b', buyerAmount: 99, friendAmount: 89, paid: 277 };
  assert.deepEqual(F.planGroupOutcome({ ...base, result: { ok: true, booked: [{ member_id: 'b' }, { member_id: 'f1' }, { member_id: 'f2' }], already: [] } }),
    { full: false, refund: 0, booked: ['b', 'f1', 'f2'], already: [] });
  assert.deepEqual(F.planGroupOutcome({ ...base, result: { ok: true, booked: [{ member_id: 'b' }, { member_id: 'f2' }], already: ['f1'] } }),
    { full: false, refund: 89, booked: ['b', 'f2'], already: ['f1'] });
  assert.equal(F.planGroupOutcome({ ...base, result: { ok: true, booked: [{ member_id: 'f1' }], already: ['b', 'f2'] } }).refund, 188);
  assert.deepEqual(F.planGroupOutcome({ ...base, result: { ok: false, reason: 'full' } }), { full: true, refund: 277, booked: [], already: [] });
  assert.equal(F.planGroupOutcome({ ...base, result: { ok: true, booked: [], already: ['b', 'f1', 'f2'] } }).full, true);
  assert.equal(F.planGroupOutcome({ ...base, result: null }).refund, 277);
  // A typed friend who could not become a separate member: their ticket comes back too.
  assert.deepEqual(F.planGroupOutcome({ ...base, unused: 1, result: { ok: true, booked: [{ member_id: 'b' }, { member_id: 'f1' }], already: [] } }),
    { full: false, refund: 89, booked: ['b', 'f1'], already: [] });
  assert.equal(F.planGroupOutcome({ ...base, unused: 1, result: { ok: true, booked: [{ member_id: 'f2' }], already: ['b'] } }).refund, 188);
});

test('small helpers', () => {
  assert.equal(F.joinNames(['Ali']), 'Ali');
  assert.equal(F.joinNames(['Ali', 'Mona']), 'Ali and Mona');
  assert.equal(F.joinNames(['Ali', 'Mona', 'Sam']), 'Ali, Mona and Sam');
  assert.equal(F.firstName('  Sara  Khan '), 'Sara');
  assert.equal(F.firstName(null), '');
  assert.equal(F.validToken('a'.repeat(64)), true);
  assert.equal(F.validToken('A'.repeat(64)), false);
  assert.equal(F.validToken('a'.repeat(63)), false);
  assert.equal(F.cleanEmail(' X@Y.CO '), 'x@y.co');
  assert.equal(F.cleanEmail('nope'), null);
});

test('client checkRows mirrors the server rules', () => {
  assert.deepEqual(C.checkRows([], 'me@x.com'), { n: 0, friends: [], error: '' });
  assert.deepEqual(C.checkRows([{ name: '', email: '' }], 'me@x.com'), { n: 0, friends: [], error: '' });
  const one = C.checkRows([{ name: 'Ali', email: 'Ali@Mail.com' }], 'me@x.com');
  assert.deepEqual(one, { n: 1, friends: [{ name: 'Ali', email: 'ali@mail.com' }], error: '' });
  assert.equal(C.checkRows([{ name: 'Ali', email: 'ali@' }]).error, 'Check the email for Ali.');
  assert.equal(C.checkRows([{ name: 'Me', email: 'me@x.com' }], 'ME@x.com').error, "That's your own email. Add your friend's.");
  assert.equal(C.checkRows([{ name: 'A', email: 'a@b.co' }, { name: 'B', email: 'a@b.co' }]).error, 'a@b.co is on the list twice.');
  assert.equal(C.checkRows([{ name: 'A', email: 'a@b.co' }, { name: 'B', email: 'a@b.co' }]).error,
    F.cleanFriends([{ name: 'A', email: 'a@b.co' }, { name: 'B', email: 'a@b.co' }]).error);
  // The client and the server agree on every case above.
  const rows = [{ name: ' Ali ', email: 'ALI@mail.com' }, { name: 'Mona', email: 'mona@mail.com' }];
  assert.deepEqual(C.checkRows(rows, 'me@x.com').friends, F.cleanFriends(rows, 'me@x.com').friends);
});

test('client fitMessage, groupTotal, timeLeft', () => {
  assert.equal(C.fitMessage('B', 8, 3), '');
  assert.equal(C.fitMessage('B', 3, 3), '');
  assert.equal(C.fitMessage('B', 2, 3), 'Station B has room for 2 of you. Pick another station or remove a friend.');
  assert.equal(C.fitMessage('B', 0, 3), 'Station B is full. Pick another station.');
  assert.equal(C.fitMessage(null, 0, 3), '');
  assert.equal(C.groupTotal(99, 99, 2), 297);
  assert.equal(C.groupTotal(49.5, 89, 1), 138.5);
  assert.equal(C.timeLeft(new Date(NOW + (23 * 60 + 10) * 60e3).toISOString(), NOW), '23h 10m left');
  assert.equal(C.timeLeft(new Date(NOW + 45 * 60e3 + 30e3).toISOString(), NOW), '45m left');
  assert.equal(C.timeLeft(new Date(NOW + 20e3).toISOString(), NOW), 'Under a minute left');
  assert.equal(C.timeLeft(new Date(NOW - 1).toISOString(), NOW), 'Ended');
});

test('client copy: when, share text, landing states', () => {
  assert.equal(C.whenText({ session_date: '2026-11-08', start_time: '12:45:00' }), 'Sun 8 Nov · 12:45 PM');
  assert.equal(C.whenText({ session_date: '2026-11-08', start_time: '08:05:00' }), 'Sun 8 Nov · 8:05 AM');
  assert.equal(C.whenText(null), '');
  const share = C.shareText({ station: 'B', when: 'Sun 8 Nov · 12:45 PM', price: 99, link: 'https://www.lfgdubai.com/bootcamp?join=x' });
  assert.match(share, /^Training with a friend is always better\./);
  assert.match(share, /Station B/);
  assert.match(share, /AED 99/);
  assert.equal(share.indexOf('—'), -1, 'no em dashes in copy');
  assert.equal(C.landingCopy({ status: 'active', host_first_name: 'Sara', station: 'B' }).title, 'Join Sara on Station B');
  assert.equal(C.landingCopy({ status: 'active', host_first_name: null, station: 'B' }).title, 'Join your friend on Station B');
  for (const status of ['expired', 'cancelled', 'full', 'closed', 'invalid']) {
    const c = C.landingCopy({ status, host_first_name: 'Sara', station: 'B' });
    assert.ok(c.title && c.text, status);
    assert.equal((c.title + c.text).indexOf('—'), -1, 'no em dashes: ' + status);
  }
  // A free Sunday holds a friend's spot 6 hours (sql/2026-11-06_free_sunday_short_holds.sql).
  assert.match(C.landingCopy({ status: 'expired', host_first_name: 'Sara', station: 'B', free: true }).text, /held for 6 hours/);
  assert.match(C.landingCopy({ status: 'expired', host_first_name: 'Sara', station: 'B' }).text, /held for 24 hours/);
});

test('emails: friend confirmation, invite, refund', () => {
  const E = require('../api/_email');
  const conf = E.buildSingleConfirmation({ firstName: 'Ali', sessionDate: '2026-11-08', section: 'B', location: 'CrossFit Alioth',
    paidAmount: 0, timeLabel: '12:45 PM', bookedBy: 'Sara <x>' });
  assert.match(conf, /Sara &lt;x&gt; booked you a spot/);
  assert.match(conf, /Booked by Sara &lt;x&gt;/);
  assert.match(conf, /Sign in to <a [^>]+>My Account<\/a> with this email/);
  const plain = E.buildSingleConfirmation({ firstName: 'Ali', sessionDate: '2026-11-08', section: 'B', paidAmount: 99, timeLabel: '12:45 PM' });
  assert.match(plain, /See you on the turf\./);
  assert.match(plain, /Paid AED 99/);
  assert.doesNotMatch(plain, /booked you a spot/);
  const noted = E.buildSingleConfirmation({ firstName: 'Sara', sessionDate: '2026-11-08', section: 'C', paidAmount: 287, note: 'You booked Ali and Mona on Station C with you.' });
  assert.match(noted, /You booked Ali and Mona on Station C with you\./);

  const inv = E.buildFriendInvite({ firstName: 'Ali', hostFirst: 'Sara', sessionDate: '2026-11-08', timeLabel: '12:45 PM', location: 'CrossFit Alioth',
    section: 'B', priceAed: 89, link: 'https://www.lfgdubai.com/bootcamp?join=' + 'a'.repeat(64), untilLabel: 'Mon 3 Nov, 2:20 pm' });
  assert.match(inv, /Join Sara/);
  assert.match(inv, /Same price as a normal ticket: AED 89/);
  assert.match(inv, /href="https:\/\/www\.lfgdubai\.com\/bootcamp\?join=a{64}"/);
  assert.match(inv, /Training with a friend is always better\./);

  const ref = E.buildRefundNotice({ firstName: 'Sara', sessionDate: '2026-11-08', amount: 287, group: true, refunded: true, reason: 'full' });
  assert.match(ref, /filled up while you were paying, so we could not book your group in/);
  assert.match(ref, /We refunded AED 287 to your card/);
  assert.match(E.buildRefundNotice({ sessionDate: '2026-11-08', amount: 99, refunded: false, reason: 'closed' }), /was called off, so we could not book you in/);
  for (const html of [conf, inv, ref]) assert.equal(html.indexOf('—'), -1, 'no em dashes in the new emails');
});

test('C: capacityForBooker grows a Sunday that held spots fill, never past max', () => {
  const sun = { capacity: 32, max_capacity: 96, bump_increment: 10 };
  assert.equal(F.capacityForBooker(sun, 24, 8), 48);    // 24 booked + four 2-person checkouts: 42, rounded to whole pairs per station
  assert.equal(F.capacityForBooker(sun, 24, 7), 32);    // room left: nothing to grow
  assert.equal(F.capacityForBooker({ capacity: 32, max_capacity: 32, bump_increment: 10 }, 24, 8), 32);
  assert.equal(F.capacityForBooker({ capacity: 90, max_capacity: 96, bump_increment: 10 }, 80, 10), 96);
  assert.equal(F.capacityForBooker({ capacity: 32 }, 30, 2), 32);   // no max_capacity: a hard cap
  assert.equal(F.capacityForBooker({ capacity: 30, max_capacity: 96, bump_increment: 10, stations: 3 }, 26, 4), 42);  // 40, pairs of 3
});

test('F: the refund email for a group that was already booked says so', () => {
  const E = require('../api/_email');
  const g = E.buildRefundNotice({ firstName: 'Sara', sessionDate: '2026-11-08', amount: 188, group: true, refunded: true, reason: 'already_booked' });
  assert.match(g, /Already <span[^>]*>booked\.<\/span>/);
  assert.match(g, /Everyone in your group was already booked for Sunday,? 8 November, so there was nothing new to book\./);
  assert.match(g, /We refunded AED 188 to your card/);
  assert.match(g, /href="https:\/\/www\.lfgdubai\.com\/account"[^>]*>See my bookings</);
  assert.doesNotMatch(g, /filled up|No spot this/);
  const solo = E.buildRefundNotice({ amount: 99, refunded: false, reason: 'already_booked' });
  assert.match(solo, /You were already booked for that Sunday, so there was nothing new to book\./);
  for (const html of [g, solo]) assert.equal(html.indexOf('—'), -1, 'no em dashes');
  // The other reasons read as before.
  assert.match(E.buildRefundNotice({ sessionDate: '2026-11-08', amount: 99, refunded: true, reason: 'full' }),
    /filled up while you were paying, so we could not book you in\./);
});
