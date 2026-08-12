// POST /api/padel-waitlist  - MEMBERS ONLY. Join (or leave) the waiting list for
// a padel night that is already full.
//
// A sold-out night used to be a dead end: the drawer said "This night is sold
// out" and the player closed the tab. Padel nights are 16 spots and people drop
// (the 2pm cancellation rule exists precisely because they do), so the sold-out
// state is the moment to capture demand, not lose it.
//
// Deliberately NO payment here. A waitlisted player owes nothing until a spot
// actually opens; charging for a maybe would be the wrong end of the trade, and
// refunding padel is manual. When someone drops, the admin invites the next in
// line from the roster and they pay through the normal checkout.
//
//   POST { action: 'join' }   -> { ok, position }
//   POST { action: 'leave' }  -> { ok }
//   GET  ?                    -> { on_list, position, count } for the signed-in member
const { admin, getUser, ensureMember, safeError } = require('./_lib');
const { resolveEvent } = require('./padel-status');

module.exports = async (req, res) => {
  const db = admin();

  let user = null;
  try { user = await getUser(req); } catch (e) { user = null; }
  if (!user) return res.status(401).json({ error: 'Log in to join the waiting list.', login_required: true });

  try {
    const { data: cfg } = await db.from('event_config')
      .select('padel_enabled, padel_datetime, padel_capacity')
      .eq('id', 1).maybeSingle();
    if (!cfg || !cfg.padel_enabled || !cfg.padel_datetime) {
      return res.status(400).json({ error: 'Padel bookings are not open yet.' });
    }
    const ev = resolveEvent(cfg.padel_datetime);
    if (!ev) return res.status(400).json({ error: 'Padel bookings are not open yet.' });

    const memberId = await ensureMember(db, user);
    if (!memberId) return res.status(400).json({ error: 'Could not read your account. Try again.' });

    // Position is "how many joined before you", counted the same way for GET and
    // POST so the number a player is told never disagrees with the roster order.
    const position = async () => {
      const { data: row } = await db.from('padel_waitlist')
        .select('created_at').eq('member_id', memberId).eq('event_date', ev.ymd).maybeSingle();
      if (!row) return null;
      const { count } = await db.from('padel_waitlist')
        .select('member_id', { count: 'exact', head: true })
        .eq('event_date', ev.ymd).lt('created_at', row.created_at);
      return (count || 0) + 1;
    };

    if (req.method === 'GET') {
      const { count } = await db.from('padel_waitlist')
        .select('member_id', { count: 'exact', head: true }).eq('event_date', ev.ymd);
      return res.status(200).json({ on_list: (await position()) != null, position: await position(), count: count || 0 });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const action = (req.body || {}).action;

    if (action === 'leave') {
      await db.from('padel_waitlist').delete().eq('member_id', memberId).eq('event_date', ev.ymd);
      return res.status(200).json({ ok: true, on_list: false });
    }

    // Already paid in? Then there is nothing to wait for, and a waitlist row for
    // a player who is already on the court would mislead the invite order.
    const { data: paidRow } = await db.from('padel_signups')
      .select('member_id').eq('member_id', memberId).eq('event_date', ev.ymd).eq('paid', true).maybeSingle();
    if (paidRow) return res.status(409).json({ already_in: true, error: "You're already in for this night." });

    // Only a genuinely full night takes a waiting list. If a spot freed up
    // between the page loading and this call, say so instead of parking a
    // player who could just book.
    const { count: paidCount } = await db.from('padel_signups')
      .select('member_id', { count: 'exact', head: true })
      .eq('event_date', ev.ymd).eq('paid', true);
    if ((paidCount || 0) < Number(cfg.padel_capacity || 16)) {
      return res.status(409).json({ spot_open: true, error: 'A spot just opened. Book it now.' });
    }

    const { error: insErr } = await db.from('padel_waitlist')
      .upsert({ member_id: memberId, event_date: ev.ymd }, { onConflict: 'member_id,event_date' });
    if (insErr) return safeError(res, 'padel-waitlist', insErr, 'Could not join the waiting list. Try again.');

    return res.status(200).json({ ok: true, on_list: true, position: await position() });
  } catch (e) {
    return safeError(res, 'padel-waitlist', e, 'Could not join the waiting list. Try again.');
  }
};
