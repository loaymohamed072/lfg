// GET /api/packages - active credit packs for the buy UI.
// NOTE: uses service-role (admin) because the lfg_dev schema is locked at
// schema level - anon role has no USAGE on lfg_dev. Switching to publicDb()
// requires granting anon partial access + adding an RLS policy for active=true.
// Tracked as a future hardening sprint; the endpoint itself only emits public
// catalogue data so the practical risk of service-role here is minimal.
const { admin, safeError, earlyWeekPromo } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const db = admin();
    const [{ data, error }, promo] = await Promise.all([
      db.from('packages')
        .select('id,name,sessions_count,price_aed,validity_months')
        .eq('active', true)
        .order('sessions_count'),
      earlyWeekPromo(db)
    ]);
    if (error) throw new Error(error.message);
    // Prices stay the list prices; the widget applies `promo` on top so the
    // strikethrough and the charge come from the same numbers.
    res.status(200).json({
      packages: data || [],
      single_price: Number(process.env.SINGLE_SESSION_PRICE_AED || 99),
      promo: promo
    });
  } catch (e) {
    return safeError(res, '/api/packages', e, 'Failed to load packages');
  }
};
