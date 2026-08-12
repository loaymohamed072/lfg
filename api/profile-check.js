// POST /api/profile-check - one question for the sign-up forms: does this email
// need to give an Instagram handle?
//
// Loay's rule: Instagram is mandatory for a NEW account, optional for someone who
// already has a profile on file. The forms call this on email blur and flip the
// field's required state. Response is deliberately minimal - it never returns the
// handle itself or anything else about the account.
//
// Body: { email }
// Returns: { known: bool, instagram_required: bool }
const { admin } = require('./_lib');

function cleanEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const email = cleanEmail((req.body || {}).email);
  if (!email) return res.status(400).json({ error: 'A valid email is required' });

  try {
    const db = admin();
    const { data: reg } = await db
      .from('run_registrations')
      .select('id, instagram_handle')
      .eq('email', email)
      .maybeSingle();

    // Known profile: the handle stays optional (we either have it, or we nudge
    // without blocking a returning member). Unknown email = new account = required.
    if (reg) {
      return res.status(200).json({ known: true, instagram_required: false });
    }
    return res.status(200).json({ known: false, instagram_required: true });
  } catch (e) {
    // Fail open: a hiccup here must never block a registration or a payment.
    console.warn('[/api/profile-check]', e && e.message);
    return res.status(200).json({ known: false, instagram_required: false });
  }
};
