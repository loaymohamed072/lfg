// GET /api/merch - public product info for the shop page.
// Returns the single tee's price, the size list, and which sizes are sold out
// (admin-controlled via event_config.tee_soldout_sizes). Uses service-role like
// /api/packages because the schema is locked to anon.
const { admin, safeError } = require('./_lib');

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const db = admin();
    const { data: cfg } = await db.from('event_config').select('tee_soldout_sizes,tee_stock').eq('id', 1).maybeSingle();
    const stock = (cfg && cfg.tee_stock) || {};
    const stockConfigured = stock && Object.keys(stock).length > 0;

    let soldout = [];
    const remaining = {};
    if (stockConfigured) {
      // Availability = stock set by admin minus units already sold (paid/fulfilled).
      // No reservation/hold for pending checkouts - once paid units hit the cap, it's sold out.
      const { data: orders } = await db.from('merch_orders').select('size,status').neq('status', 'cancelled');
      const sold = {};
      (orders || []).forEach(o => { if (o.size) sold[o.size] = (sold[o.size] || 0) + 1; });
      SIZES.forEach(sz => {
        const rem = Math.max(0, Number(stock[sz] || 0) - (sold[sz] || 0));
        remaining[sz] = rem;
        if (rem <= 0) soldout.push(sz);
      });
    } else {
      // Stock not configured yet → fall back to the legacy manual sold-out toggle.
      soldout = (cfg && cfg.tee_soldout_sizes) || [];
    }

    res.status(200).json({
      product: 'lfg-tee-2025',
      name: 'LFG × PUMA Tee',
      price_aed: Number(process.env.MERCH_TEE_PRICE_AED || 150),
      sizes: SIZES,
      soldout: soldout,
      remaining: remaining,
      stock: stock,
      stock_configured: stockConfigured
    });
  } catch (e) {
    return safeError(res, '/api/merch', e, 'Failed to load product');
  }
};
