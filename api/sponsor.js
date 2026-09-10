// GET /api/sponsor - what a "Sponsor a bootcamp" card needs: the price per
// ticket and how many the community has paid forward so far. Public, because
// the card also runs on the homepage where nobody is signed in; a signed-in
// member additionally gets their own sponsorship history. Purchase itself goes
// through /api/checkout with kind:'sponsor'; hand-outs live in
// /api/admin/sponsored. Aggregate counts only, never who was given what, and
// never another sponsor's name, amount or note.
const { admin, getUser, safeError } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  try {
    const db = admin();
    const { data: all, error: aErr } = await db.from('sponsored_tickets').select('qty');
    if (aErr) throw new Error(aErr.message);
    const community = (all || []).reduce((n, r) => n + Number(r.qty || 0), 0);

    const payload = {
      price_aed: Number(process.env.SINGLE_SESSION_PRICE_AED || 99),
      community_total: community,
      yours_total: 0,
      yours: []
    };

    if (user) {
      const { data: mine, error: mErr } = await db.from('sponsored_tickets')
        .select('qty, amount_aed, note, purchased_at')
        .eq('sponsor_member_id', user.id).order('purchased_at', { ascending: false });
      if (mErr) throw new Error(mErr.message);
      payload.yours = mine || [];
      payload.yours_total = (mine || []).reduce((n, r) => n + Number(r.qty || 0), 0);
    }

    return res.status(200).json(payload);
  } catch (e) {
    return safeError(res, '/api/sponsor', e, 'Could not load sponsored tickets');
  }
};
