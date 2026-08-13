// Admin: padel night roster + level control.
//
//   GET  /api/admin/padel-roster?date=YYYY-MM-DD
//        -> { event, dates, players } — players carry profile level + quiz
//           answers so the admin sees who's coming and at what level. The
//           courts view is grouped client-side from this list.
//   POST /api/admin/padel-roster { member_id, delta | level }
//        -> nudge a player's level ±0.5 (or set it outright), clamped 1.0-7.0.
//           This IS the ranking update loop: watch them play, nudge the level,
//           next week's courts regroup around it. initial_level stays frozen.
const { requireAdmin, safeError } = require('../_lib');
const { resolveEvent } = require('../padel-status');

module.exports = async (req, res) => {
  const gate = await requireAdmin(req, res);
  if (!gate) return;
  const { db } = gate;

  try {
    const { data: cfg } = await db.from('event_config')
      .select('padel_enabled, padel_datetime, padel_location, padel_price_aed, padel_capacity')
      .eq('id', 1).maybeSingle();
    const current = cfg && cfg.padel_datetime ? resolveEvent(cfg.padel_datetime) : null;

    if (req.method === 'POST') {
      const body = req.body || {};
      const memberId = typeof body.member_id === 'string' ? body.member_id : null;
      if (!memberId) return res.status(400).json({ error: 'member_id required' });

      // King of the Court scoring: winners bank points each round. Per-night,
      // so it lives on the signup row and needs the event date.
      if (typeof body.points_delta === 'number') {
        const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date || '')) ? body.event_date : null;
        if (!eventDate) return res.status(400).json({ error: 'event_date required for points' });
        const { data: row } = await db.from('padel_signups')
          .select('points').eq('member_id', memberId).eq('event_date', eventDate).maybeSingle();
        if (!row) return res.status(404).json({ error: 'No signup for that member and night' });
        const points = Math.max(0, (row.points || 0) + Math.round(body.points_delta));
        const { error: pErr } = await db.from('padel_signups')
          .update({ points, updated_at: new Date().toISOString() })
          .eq('member_id', memberId).eq('event_date', eventDate);
        if (pErr) return safeError(res, 'padel-roster', pErr, 'Could not update points.');
        return res.status(200).json({ ok: true, points });
      }

      // Roll a spot forward a week. The published policy is "tell us by 2pm and
      // your payment rolls to next week" — no refund, the money follows the
      // player. Moving the signup AND its payment row keeps the two in step, so
      // revenue still reconciles against the night it was actually played.
      //
      // Frees this week's spot as a side effect: capacity counts paid signups on
      // a date, so the moment the row moves, the waiting list can take the seat.
      if (body.action === 'roll_forward') {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date || '')) ? body.event_date : null;
        if (!from) return res.status(400).json({ error: 'event_date required' });
        const to = new Date(new Date(from + 'T12:00:00Z').getTime() + 7 * 86400000)
          .toISOString().slice(0, 10);

        const { data: row } = await db.from('padel_signups')
          .select('member_id, paid').eq('member_id', memberId).eq('event_date', from).maybeSingle();
        if (!row) return res.status(404).json({ error: 'No signup for that player on this night.' });

        // Already booked next week? Moving would collide on the primary key and
        // silently swallow one of the two payments.
        const { data: clash } = await db.from('padel_signups')
          .select('member_id').eq('member_id', memberId).eq('event_date', to).maybeSingle();
        if (clash) {
          return res.status(409).json({ error: 'They are already booked for ' + to + '. Cancel one of the two by hand.' });
        }

        const { error: sErr } = await db.from('padel_signups')
          .update({ event_date: to, points: 0, updated_at: new Date().toISOString() })
          .eq('member_id', memberId).eq('event_date', from);
        if (sErr) return safeError(res, 'padel-roster', sErr, 'Could not move the spot.');

        await db.from('payments')
          .update({ run_date: to })
          .eq('member_id', memberId).eq('kind', 'padel').eq('run_date', from).eq('status', 'paid');

        // Teams and fixtures are built per night from the paid list. A player who
        // is no longer playing must not stay on a court, so drop them from any
        // team already drawn for the night they left.
        await db.from('padel_teams').delete().eq('event_date', from).eq('player_a', memberId);
        await db.from('padel_teams').delete().eq('event_date', from).eq('player_b', memberId);

        return res.status(200).json({ ok: true, moved_to: to });
      }

      const { data: prof } = await db.from('padel_profiles')
        .select('level').eq('member_id', memberId).maybeSingle();
      if (!prof) return res.status(404).json({ error: 'No padel profile for that member' });
      let next;
      if (typeof body.level === 'number') next = body.level;
      else if (typeof body.delta === 'number') next = Number(prof.level) + body.delta;
      else return res.status(400).json({ error: 'delta or level required' });
      next = Math.min(7, Math.max(1, Math.round(next * 2) / 2));
      const { error: uErr } = await db.from('padel_profiles')
        .update({ level: next, updated_at: new Date().toISOString() })
        .eq('member_id', memberId);
      if (uErr) return safeError(res, 'padel-roster', uErr, 'Could not update the level.');
      return res.status(200).json({ ok: true, level: next });
    }

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Selectable night: explicit ?date=, else the current resolved night.
    const q = (req.query && req.query.date) || '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q)) ? String(q) : (current ? current.ymd : null);
    if (!date) return res.status(200).json({ event: null, dates: [], players: [] });

    // Past nights with money on them, for the date selector.
    const { data: paidDates } = await db.from('payments')
      .select('run_date').eq('kind', 'padel').eq('status', 'paid')
      .not('run_date', 'is', null).order('run_date', { ascending: false }).limit(200);
    const dates = [...new Set([...(current ? [current.ymd] : []), ...(paidDates || []).map(r => r.run_date)])].slice(0, 12);

    const { data: signups } = await db.from('padel_signups')
      .select('member_id, paid, amount_aed, points, created_at')
      .eq('event_date', date).eq('attending', true)
      .order('created_at', { ascending: true });

    const ids = (signups || []).map(s => s.member_id);
    let membersById = {}, profilesById = {};
    if (ids.length) {
      const { data: mems } = await db.from('members')
        .select('id, full_name, email').in('id', ids);
      (mems || []).forEach(m => { membersById[m.id] = m; });
      const { data: profs } = await db.from('padel_profiles')
        .select('member_id, level, initial_level, answers, created_at').in('member_id', ids);
      (profs || []).forEach(p => { profilesById[p.member_id] = p; });
    }

    // "First night" = the quiz was answered within the week before this night,
    // i.e. this signup is what created the profile. A badge for the host, so
    // brand-new players get a welcome and a sanity-check on their seeded level.
    const weekBefore = new Date(new Date(date + 'T00:00:00Z').getTime() - 6 * 86400000).toISOString();
    const players = (signups || []).map(s => {
      const m = membersById[s.member_id] || {};
      const p = profilesById[s.member_id] || null;
      return {
        member_id: s.member_id,
        name: m.full_name || null,
        email: m.email || null,
        paid: !!s.paid,
        amount_aed: s.amount_aed || null,
        points: s.points || 0,
        level: p ? Number(p.level) : null,
        initial_level: p ? Number(p.initial_level) : null,
        first_night: p ? p.created_at >= weekBefore : true,
        answers: p ? p.answers : null
      };
    });

    return res.status(200).json({
      event: {
        date,
        is_current: !!(current && current.ymd === date),
        location: cfg ? cfg.padel_location : null,
        capacity: cfg ? Number(cfg.padel_capacity || 16) : 16,
        price_aed: cfg ? Number(cfg.padel_price_aed || 0) : 0,
        enabled: !!(cfg && cfg.padel_enabled)
      },
      dates,
      players
    });
  } catch (e) {
    return safeError(res, 'padel-roster', e, 'Could not load the padel roster.');
  }
};
