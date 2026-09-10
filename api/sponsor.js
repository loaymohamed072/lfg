// GET /api/sponsor - signed-in members. What the "Sponsor a bootcamp" card on
// /account needs: the price per ticket, how many the community has paid
// forward so far, and this member's own sponsorships. Purchase itself goes
// through /api/checkout with kind:'sponsor'; hand-outs live in
// /api/admin/sponsored. Aggregate counts only, never who was given what.
const { admin, getUser, safeError } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const db = admin();
    const [{ data: all, error: aErr }, { data: mine, error: mErr }] = await Promise.all([
      db.from('sponsored_tickets').select('qty'),
      db.from('sponsored_tickets').select('qty, amount_aed, note, purchased_at')
        .eq('sponsor_member_id', user.id).order('purchased_at', { ascending: false })
    ]);
    if (aErr) throw new Error(aErr.message);
    if (mErr) throw new Error(mErr.message);
    const community = (all || []).reduce((n, r) => n + Number(r.qty || 0), 0);
    const yours = (mine || []).reduce((n, r) => n + Number(r.qty || 0), 0);
    return res.status(200).json({
      price_aed: Number(process.env.SINGLE_SESSION_PRICE_AED || 99),
      community_total: community,
      yours_total: yours,
      yours: mine || []
    });
  } catch (e) {
    return safeError(res, '/api/sponsor', e, 'Could not load sponsored tickets');
  }
};
