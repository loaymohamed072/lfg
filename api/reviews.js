// GET /api/reviews - approved member reviews for the bootcamp page.
// Public. Returns only what the page renders: rating, name, comment, date.
// Never the email or the IP we store alongside them.
const { admin } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await admin()
      .from('reviews')
      .select('rating, name, comment, approved_at')
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(24);
    if (error) throw new Error(error.message);

    const reviews = data || [];
    const avg = reviews.length
      ? reviews.reduce((a, r) => a + Number(r.rating || 0), 0) / reviews.length
      : null;

    // Short edge cache: long enough to absorb traffic, short enough that a
    // review approved in the admin shows up while you are still looking.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({
      ok: true,
      count: reviews.length,
      average: avg == null ? null : Math.round(avg * 10) / 10,
      reviews
    });
  } catch (e) {
    console.error('[/api/reviews]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
