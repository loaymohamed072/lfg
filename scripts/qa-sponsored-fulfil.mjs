// QA probe for the sponsored-tickets money path, without charging a card.
//
//   node --env-file=.env scripts/qa-sponsored-fulfil.mjs <member-email> [qty]
//   node --env-file=.env scripts/qa-sponsored-fulfil.mjs --cleanup
//
// Feeds a fake, clearly-marked Checkout Session object straight into
// fulfillCheckoutSession(), exactly as the Stripe webhook would, and prints
// what landed: the payments row (claim_fulfilment), the sponsored_tickets row,
// and the pool. --cleanup removes every row this probe created. Nothing here
// touches Stripe, and the probe session ids all start with cs_qa_sponsor_.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = require('../api/_lib.js');

const PREFIX = 'cs_qa_sponsor_';
const db = lib.admin();

async function cleanup() {
  const { data: rows } = await db.from('sponsored_tickets').select('id, stripe_session_id').like('stripe_session_id', PREFIX + '%');
  const ids = (rows || []).map((r) => r.id);
  if (ids.length) {
    await db.from('sponsored_ticket_allocations').delete().in('sponsored_ticket_id', ids);
    await db.from('sponsored_tickets').delete().in('id', ids);
  }
  const { data: pays } = await db.from('payments').delete().like('stripe_session_id', PREFIX + '%').select('id');
  console.log('cleanup: removed', ids.length, 'sponsorship(s),', (pays || []).length, 'payment row(s)');
}

async function main() {
  if (process.argv.includes('--cleanup')) return cleanup();
  // --guest exercises the homepage path: a sponsor with no LFG account, whose
  // name and email come from Stripe rather than from a members row.
  const guest = process.argv.includes('--guest');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const email = (args[0] || '').trim().toLowerCase();
  const qty = Math.max(1, Math.min(50, parseInt(args[1] || '2', 10) || 2));
  let m = null;
  if (guest) {
    if (!email) { console.error('usage: qa-sponsored-fulfil.mjs --guest <any-email> [qty]'); process.exit(1); }
    m = { id: null, full_name: 'QA Guest Sponsor', email: email };
  } else {
    if (!email) { console.error('usage: qa-sponsored-fulfil.mjs <member-email> [qty] | --guest <email> [qty] | --cleanup'); process.exit(1); }
    const found = await db.from('members').select('id, full_name, email').ilike('email', email).maybeSingle();
    m = found.data;
    if (!m) { console.error('no member with that email'); process.exit(1); }
  }

  const stamp = Date.now();
  const perTicket = Number(process.env.SINGLE_SESSION_PRICE_AED || 99);
  const fakeSession = {
    id: PREFIX + stamp,
    payment_intent: 'pi_qa_sponsor_' + stamp,
    amount_total: perTicket * qty * 100,
    customer_details: { name: m.full_name || null, email: m.email || null },
    metadata: Object.assign(
      { kind: 'sponsor', qty: String(qty), note: 'QA probe, not a real sponsorship' },
      m.id ? { member_id: m.id } : {}
    ),
  };
  console.log('fulfilling fake session', fakeSession.id, 'for', m.email, guest ? '(GUEST, no account)' : '(member)', 'qty', qty);
  const result = await lib.fulfillCheckoutSession(db, fakeSession);
  console.log('fulfil result:', result);

  const { data: pay } = await db.from('payments').select('kind, status, amount_aed').eq('stripe_session_id', fakeSession.id).maybeSingle();
  const { data: sp } = await db.from('sponsored_tickets').select('qty, amount_aed, note, sponsor_member_id, sponsor_name, sponsor_email').eq('stripe_session_id', fakeSession.id).maybeSingle();
  const { data: all } = await db.from('sponsored_tickets').select('qty');
  console.log('payments row:', pay);
  console.log('sponsored_tickets row:', sp);
  console.log('pool purchased total:', (all || []).reduce((n, r) => n + r.qty, 0));
  // Replay: the webhook can deliver twice. Second pass must be a no-op.
  const again = await lib.fulfillCheckoutSession(db, fakeSession);
  console.log('replay result (expect dedup):', again);
}

main().catch((e) => { console.error(e); process.exit(1); });
