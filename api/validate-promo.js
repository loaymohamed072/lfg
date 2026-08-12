// POST /api/validate-promo - preview a promo code's discount on a session or pack.
// Body: { code, kind: 'single'|'package', package_id? }
// Member-authenticated so anonymous traffic can't probe the code catalog.
//
// Per-member rate limit: 10 attempts per 5 minutes. Stops a logged-in user from
// spamming common-word codes to discover hidden ones. Module-scoped Map resets
// on serverless cold start, which is a soft floor (Stripe still requires the
// final code be valid, so attackers gain nothing real). 429 with retry-after.
const { admin, getUser, validatePromoCode } = require('./_lib');

const PROMO_LIMIT = 10;
const PROMO_WINDOW_MS = 5 * 60 * 1000;
// Use a process-global so the dev server's hot-reload of /api/* modules per
// request doesn't wipe the bucket on every call. Vercel warm instances also
// keep this between invocations.
const promoBucket = (global.__lfgPromoBucket = global.__lfgPromoBucket || new Map());

function checkRate(memberId) {
  const now = Date.now();
  const e = promoBucket.get(memberId);
  if (!e || e.resetAt < now) {
    promoBucket.set(memberId, { count: 1, resetAt: now + PROMO_WINDOW_MS });
    return { allowed: true };
  }
  e.count++;
  if (e.count > PROMO_LIMIT) {
    return { allowed: false, retryInSeconds: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
  }
  return { allowed: true };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const rate = checkRate(user.id);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryInSeconds));
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a minute.' });
  }

  const body = req.body || {};
  const kind = body.kind;
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) return res.status(400).json({ ok: false, error: 'Enter a code' });

  try {
    const db = admin();
    let baseAmount;
    if (kind === 'package') {
      const { data: pkg } = await db.from('packages').select('price_aed').eq('id', body.package_id).eq('active', true).maybeSingle();
      if (!pkg) return res.status(400).json({ ok: false, error: 'Package not found' });
      baseAmount = Number(pkg.price_aed);
    } else if (kind === 'single') {
      baseAmount = Number(process.env.SINGLE_SESSION_PRICE_AED || 99);
    } else {
      return res.status(400).json({ ok: false, error: 'Invalid kind' });
    }

    const result = await validatePromoCode(db, code, baseAmount, user.email);
    // Referral + reward (RWD-) codes are single-session only - reject them on package purchases.
    if (result.ok && kind === 'package' && (result.is_referral || /^RWD-/i.test(result.code || ''))) {
      return res.status(200).json({ ok: false, error: 'Referral and reward codes only work on a single session, not packages.' });
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error('[/api/validate-promo]', e);
    return res.status(500).json({ ok: false, error: 'Could not validate' });
  }
};
