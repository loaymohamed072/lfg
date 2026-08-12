// POST /api/admin/merch-admin - admin only. Two actions:
//   { action:'set_soldout', sizes:['XL','XXL'] }   -> overwrite the sold-out size list
//   { action:'fulfill', order_id, fulfilled:true }  -> mark an order handed over (or undo)
const { admin, getUser, isAdmin } = require('../_lib');

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const action = body.action;

  try {
    if (action === 'set_soldout') {
      const raw = Array.isArray(body.sizes) ? body.sizes : [];
      // Keep only valid, distinct sizes.
      const sizes = [...new Set(raw.map(s => String(s).toUpperCase()).filter(s => SIZES.indexOf(s) !== -1))];
      const { error } = await db.from('event_config').update({ tee_soldout_sizes: sizes }).eq('id', 1);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, soldout: sizes });
    }

    if (action === 'set_stock') {
      // Per-size total stock. Availability is this minus units already sold; when it
      // hits zero the size is sold out (no holds for pending checkouts).
      const raw = (body.stock && typeof body.stock === 'object') ? body.stock : {};
      const stock = {};
      SIZES.forEach(sz => {
        const n = Number(raw[sz]);
        if (Number.isInteger(n) && n >= 0 && n <= 100000) stock[sz] = n;
      });
      const { error } = await db.from('event_config').update({ tee_stock: stock }).eq('id', 1);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, stock: stock });
    }

    if (action === 'fulfill') {
      const id = body.order_id;
      if (!id) return res.status(400).json({ error: 'Missing order_id' });
      const fulfilled = body.fulfilled !== false; // default true
      const patch = fulfilled
        ? { status: 'fulfilled', fulfilled_at: new Date().toISOString() }
        : { status: 'paid', fulfilled_at: null };
      const { error } = await db.from('merch_orders').update(patch).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, fulfilled });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[/api/admin/merch-admin]', e);
    res.status(500).json({ error: 'Server error' });
  }
};
