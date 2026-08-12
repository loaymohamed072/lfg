// POST /api/where-to-login - answers one question for the login page: does this email
// belong to an LFG Coaching client?
//
// Why this exists: the run club and the coaching app are two sites sharing one Supabase
// project. Coaching clients kept landing on www.lfgdubai.com/login (the site they know),
// signing in fine, and arriving at the run-club account page with none of their coaching
// data on it. From their side that reads as "I logged in and it sent me to the wrong site".
// The login page asks this before sending a code so it can point them at coaching.lfgdubai.com.
//
// Body: { email }
// Returns: { coaching: true|false }
//
// Deliberately narrow: it says nothing about whether a run-club account exists, only
// whether the address is an active coaching client. The coaching app's own login already
// answers the same question for its side, so this leaks nothing new.
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
    const { data: member } = await db
      .from('members')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (!member) return res.status(200).json({ coaching: false });

    const { data: client } = await db
      .from('coaching_clients')
      .select('id')
      .eq('member_id', member.id)
      .eq('status', 'active')
      .maybeSingle();

    return res.status(200).json({ coaching: Boolean(client) });
  } catch (e) {
    // Never block a sign-in over this. A failure here just means the login page
    // behaves exactly as it did before.
    console.warn('[/api/where-to-login]', e && e.message);
    return res.status(200).json({ coaching: false });
  }
};
