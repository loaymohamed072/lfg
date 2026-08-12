// /api/admin/promo-codes - admin-only CRUD for promo codes.
//
//   GET    → list all codes with redemption counts
//   POST   → create new code  body: { code?, kind, value, max_redemptions?, expires_at? }
//                             if code is omitted server generates a strong random one
//   PATCH  → update code      body: { code, active?, expires_at?, max_redemptions? }
//   DELETE → soft delete      body: { code }      (sets active=false)
//
// Server-side validation on every write. Owner-only via isAdmin.
const crypto = require('crypto');
const { admin, getUser, isAdmin } = require('../_lib');

// 'fixed' = a flat AED-off amount. Matches the DB CHECK constraint exactly.
const KIND_VALUES = new Set(['percent', 'fixed']);
const CODE_REGEX = /^[A-Z0-9_-]{2,32}$/;

function generateCode() {
  // 8 chars from an unambiguous alphabet (no 0/O/1/I/L). 32 chars × ~5 bits = ~40 bits of entropy.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sanitizeKind(k) {
  return KIND_VALUES.has(k) ? k : null;
}

function sanitizeValue(v, kind) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (kind === 'percent' && n > 100) return null;
  if (kind === 'fixed' && n > 100000) return null; // sanity ceiling
  return Math.round(n * 100) / 100;
}

function sanitizeMaxRedemptions(m) {
  if (m === null || m === undefined || m === '') return null;
  const n = Number(m);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return null;
  return n;
}

function sanitizeExpiresAt(e) {
  if (e === null || e === undefined || e === '') return null;
  const d = new Date(e);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

module.exports = async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    if (req.method === 'GET') {
      const { data, error } = await db.from('promo_codes')
        .select('code,kind,value,active,expires_at,max_redemptions,times_redeemed,created_at,email_lock')
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      // Recent redemptions, last 50, joined with member email for the audit log.
      const { data: redemptions } = await db.from('promo_redemptions')
        .select('id,code,member_id,payment_intent,redeemed_at,members(email)')
        .order('redeemed_at', { ascending: false })
        .limit(50);
      const flat = (redemptions || []).map(r => ({
        id: r.id, code: r.code, payment_intent: r.payment_intent, redeemed_at: r.redeemed_at,
        email: r.members ? r.members.email : null
      }));

      // Referral leaderboard: which members bring in the most people. Each
      // redemption of a member's personal referral code = one invite that converted.
      const { data: refRows } = await db.from('promo_codes')
        .select('code,times_redeemed,referral_owner_id')
        .not('referral_owner_id', 'is', null)
        .order('times_redeemed', { ascending: false })
        .limit(25);
      const ownerIds = [...new Set((refRows || []).map(r => r.referral_owner_id))];
      const ownerById = {};
      if (ownerIds.length) {
        const { data: ms } = await db.from('members').select('id,full_name,email').in('id', ownerIds);
        (ms || []).forEach(m => { ownerById[m.id] = m; });
      }
      const top_referrers = (refRows || []).map(r => ({
        code: r.code,
        redeemed: r.times_redeemed || 0,
        name: (ownerById[r.referral_owner_id] || {}).full_name || null,
        email: (ownerById[r.referral_owner_id] || {}).email || null
      }));

      return res.status(200).json({ codes: data || [], redemptions: flat, top_referrers });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const kind = sanitizeKind(body.kind);
      if (!kind) return res.status(400).json({ error: 'Kind must be "percent" or "fixed"' });
      const value = sanitizeValue(body.value, kind);
      if (value === null) return res.status(400).json({ error: 'Invalid value' });
      const max_redemptions = sanitizeMaxRedemptions(body.max_redemptions);
      if (body.max_redemptions !== undefined && body.max_redemptions !== null && body.max_redemptions !== '' && max_redemptions === null) {
        return res.status(400).json({ error: 'Invalid max redemptions' });
      }
      const expires_at = sanitizeExpiresAt(body.expires_at);
      if (body.expires_at && expires_at === null) return res.status(400).json({ error: 'Invalid expiry date' });

      let code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (code && !CODE_REGEX.test(code)) return res.status(400).json({ error: 'Code must be 2-32 chars, letters/digits/_/- only' });
      if (!code) code = generateCode();

      const { data: existing } = await db.from('promo_codes').select('code').eq('code', code).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Code already exists' });

      const row = { code, kind, value, max_redemptions, expires_at, active: true };
      const { data: created, error } = await db.from('promo_codes').insert(row).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ code: created });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: 'Missing code' });
      const patch = {};
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (body.expires_at !== undefined) {
        const e = sanitizeExpiresAt(body.expires_at);
        if (body.expires_at && e === null) return res.status(400).json({ error: 'Invalid expiry date' });
        patch.expires_at = e;
      }
      if (body.max_redemptions !== undefined) {
        const m = sanitizeMaxRedemptions(body.max_redemptions);
        if (body.max_redemptions && m === null) return res.status(400).json({ error: 'Invalid max redemptions' });
        patch.max_redemptions = m;
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      const { data, error } = await db.from('promo_codes').update(patch).eq('code', code).select('*').maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Code not found' });
      return res.status(200).json({ code: data });
    }

    if (req.method === 'DELETE') {
      const body = req.body || {};
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: 'Missing code' });
      // Soft delete: keep the row so we don't lose historical redemption data.
      const { data, error } = await db.from('promo_codes').update({ active: false }).eq('code', code).select('*').maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Code not found' });
      return res.status(200).json({ code: data, deactivated: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[/api/admin/promo-codes]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
