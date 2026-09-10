// /api/admin/sponsored - admins only. The sponsored-ticket pool.
//
//   GET  -> { price_aed, pool:{purchased,allocated,remaining}, sponsorships:[...], allocations:[...] }
//   POST { member_email | member_id, qty, reason? } -> hand qty tickets to a member.
//
// A hand-out is two things: the credit, delivered through the same
// adjust_credits() RPC the Members card uses (fresh comp pack, 60-day expiry,
// audited with the actor's id), and one allocation row per sponsorship it
// drew from, oldest sponsorship first, so the pool count and "who sponsored
// whose session" both stay answerable.
//
// ponytail: RPC first, then the allocation rows, not atomic. A crash between
// the two leaves credits granted with the pool not decremented, which the
// panel makes visible (allocated < credits handed out). Move both into one
// DB function when this passes tens of hand-outs a week.
const { admin, getUser, isAdmin, safeError } = require('../_lib');

const EXPIRES_DAYS = 60;

async function loadPool(db) {
  const [{ data: tickets, error: tErr }, { data: allocs, error: aErr }] = await Promise.all([
    db.from('sponsored_tickets')
      .select('id, sponsor_member_id, sponsor_name, sponsor_email, qty, amount_aed, note, purchased_at')
      .order('purchased_at', { ascending: true }),
    db.from('sponsored_ticket_allocations')
      .select('id, sponsored_ticket_id, member_id, qty, actor_admin_id, created_at')
      .order('created_at', { ascending: false })
  ]);
  if (tErr) throw new Error(tErr.message);
  if (aErr) throw new Error(aErr.message);

  const ids = new Set();
  (tickets || []).forEach((t) => { if (t.sponsor_member_id) ids.add(t.sponsor_member_id); });
  (allocs || []).forEach((a) => { ids.add(a.member_id); ids.add(a.actor_admin_id); });
  let names = new Map();
  if (ids.size) {
    const { data: mems } = await db.from('members').select('id, full_name, email').in('id', [...ids]);
    names = new Map((mems || []).map((m) => [m.id, m.full_name || m.email || 'Member']));
  }

  const usedBy = new Map();
  (allocs || []).forEach((a) => usedBy.set(a.sponsored_ticket_id, (usedBy.get(a.sponsored_ticket_id) || 0) + a.qty));

  const sponsorships = (tickets || []).map((t) => ({
    id: t.id,
    // A homepage sponsor has no member row, so fall back to what Stripe collected.
    sponsor: names.get(t.sponsor_member_id) || t.sponsor_name || t.sponsor_email || 'Guest',
    qty: t.qty,
    remaining: t.qty - (usedBy.get(t.id) || 0),
    amount_aed: Number(t.amount_aed),
    note: t.note || null,
    purchased_at: t.purchased_at
  }));
  const purchased = sponsorships.reduce((n, s) => n + s.qty, 0);
  const allocated = sponsorships.reduce((n, s) => n + (s.qty - s.remaining), 0);

  return {
    price_aed: Number(process.env.SINGLE_SESSION_PRICE_AED || 99),
    pool: { purchased, allocated, remaining: purchased - allocated },
    sponsorships: sponsorships.slice().reverse(),
    allocations: (allocs || []).map((a) => ({
      id: a.id,
      member: names.get(a.member_id) || 'Member',
      qty: a.qty,
      by: names.get(a.actor_admin_id) || 'Admin',
      sponsored_ticket_id: a.sponsored_ticket_id,
      created_at: a.created_at
    })),
    names: undefined
  };
}

module.exports = async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await loadPool(db));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    let memberId = String(body.member_id || '').trim();
    const memberEmail = typeof body.member_email === 'string' ? body.member_email.trim().toLowerCase() : '';
    const qty = Math.round(Number(body.qty));
    if (!memberId && memberEmail) {
      const { data: m } = await db.from('members').select('id').eq('email', memberEmail).maybeSingle();
      if (m && m.id) memberId = m.id;
    }
    if (!memberId) return res.status(400).json({ error: 'Member not found' });
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ error: 'Hand out between 1 and 20 tickets at a time' });

    const pool = await loadPool(db);
    if (pool.pool.remaining < qty) {
      return res.status(409).json({ error: 'Only ' + pool.pool.remaining + ' sponsored ticket' + (pool.pool.remaining === 1 ? '' : 's') + ' left in the pool' });
    }

    // Draw oldest-first so an early sponsor's tickets are used before a later
    // one's, and name them in the reason the member will see on their ledger.
    const draws = [];
    let left = qty;
    for (const s of pool.sponsorships.slice().reverse()) {
      if (left <= 0) break;
      if (s.remaining <= 0) continue;
      const take = Math.min(s.remaining, left);
      draws.push({ sponsored_ticket_id: s.id, qty: take, sponsor: s.sponsor });
      left -= take;
    }
    const sponsors = [...new Set(draws.map((d) => d.sponsor.split(/\s+/)[0]))].join(', ');
    const reason = (typeof body.reason === 'string' && body.reason.trim())
      ? body.reason.trim().slice(0, 300)
      : 'Sponsored bootcamp ticket' + (qty === 1 ? '' : 's') + ' · paid forward by ' + sponsors;

    const { data, error } = await db.rpc('adjust_credits', {
      p_member_id: memberId,
      p_actor_admin_id: user.id,
      p_delta: qty,
      p_reason: reason,
      p_expires_days: EXPIRES_DAYS
    });
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.ok !== true) return res.status(400).json(data || { ok: false, error: 'Credit failed' });

    const { error: allocErr } = await db.from('sponsored_ticket_allocations').insert(
      draws.map((d) => ({
        sponsored_ticket_id: d.sponsored_ticket_id,
        member_id: memberId,
        qty: d.qty,
        actor_admin_id: user.id
      }))
    );
    if (allocErr) console.error('[admin/sponsored] credit granted but allocation rows failed:', allocErr.message);

    return res.status(200).json({ ok: true, handed_out: qty, reason: reason, pool: (await loadPool(db)).pool });
  } catch (e) {
    return safeError(res, 'admin/sponsored', e, 'Could not update sponsored tickets.');
  }
};
