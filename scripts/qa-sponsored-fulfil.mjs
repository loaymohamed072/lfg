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
  const email = (process.argv[2] || '').trim().toLowerCase();
  const qty = Math.max(1, Math.min(50, parseInt(process.argv[3] || '2', 10) || 2));
  if (!email) { console.error('usage: qa-sponsored-fulfil.mjs <member-email> [qty] | --cleanup'); process.exit(1); }
  const { data: m } = await db.from('members').select('id, full_name, email').ilike('email', email).maybeSingle();
  if (!m) { console.error('no member with that email'); process.exit(1); }

  const stamp = Date.now();
  const perTicket = Number(process.env.SINGLE_SESSION_PRICE_AED || 99);
  const fakeSession = {
    id: PREFIX + stamp,
    payment_intent: 'pi_qa_sponsor_' + stamp,
    amount_total: perTicket * qty * 100,
    customer_details: { name: m.full_name || null },
    metadata: { member_id: m.id, kind: 'sponsor', qty: String(qty), note: 'QA probe, not a real sponsorship' },
  };
  console.log('fulfilling fake session', fakeSession.id, 'for', m.email, 'qty', qty);
  const result = await lib.fulfillCheckoutSession(db, fakeSession);
  console.log('fulfil result:', result);

  const { data: pay } = await db.from('payments').select('kind, status, amount_aed').eq('stripe_session_id', fakeSession.id).maybeSingle();
  const { data: sp } = await db.from('sponsored_tickets').select('qty, amount_aed, note').eq('stripe_session_id', fakeSession.id).maybeSingle();
  const { data: all } = await db.from('sponsored_tickets').select('qty');
  console.log('payments row:', pay);
  console.log('sponsored_tickets row:', sp);
  console.log('pool purchased total:', (all || []).reduce((n, r) => n + r.qty, 0));
  // Replay: the webhook can deliver twice. Second pass must be a no-op.
  const again = await lib.fulfillCheckoutSession(db, fakeSession);
  console.log('replay result (expect dedup):', again);
}

main().catch((e) => { console.error(e); process.exit(1); });
