// POST /api/admin/import-points - owner/coach (admin) only. Bulk-adds bootcamp
// points from a coach-filled sheet. Each row's points are ADDED on top of the
// member's existing total (a new point_awards row, same model as award-points).
//
// Body: {
//   rows:   [{ member_id?, name?, points }]   // points blank/0 = skipped
//   reason?: string                            // label stamped on every award
//   force?:  boolean                           // bypass the "already uploaded" guard
// }
//
// Matching: member_id is the source of truth (the sheet ships hidden IDs). If a
// row has no/invalid id we fall back to an EXACT, UNIQUE name match - ambiguous
// or unknown names are skipped and reported, never guessed.
//
// Duplicate guard: if any of these members already have an award with the same
// reason label, we stop and ask for confirmation (force:true) so a coach can't
// silently double-apply the same sheet.
const { admin, getUser, isAdmin } = require('../_lib');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows) return res.status(400).json({ error: 'No rows provided' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Too many rows (max 2000)' });

  const force = body.force === true;
  // Default Dubai-day label so two uploads on the same day collide (and warn).
  const dubaiDay = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const reason = (typeof body.reason === 'string' && body.reason.trim())
    ? body.reason.trim().slice(0, 200)
    : ('Bootcamp points · ' + dubaiDay);

  try {
    // Load every member once for id validation + unique-name fallback.
    const { data: members, error: mErr } = await db.from('members').select('id,full_name,email');
    if (mErr) return res.status(500).json({ error: mErr.message });
    const idSet = new Set();
    const nameMap = {}; // lowercased name -> [ids]
    (members || []).forEach(m => {
      idSet.add(m.id);
      const key = (m.full_name || '').trim().toLowerCase();
      if (key) (nameMap[key] || (nameMap[key] = [])).push(m.id);
    });

    const toInsert = [];   // { member_id, points, label }
    const skippedBlank = [];
    const errors = [];     // { row, name, reason }
    const seen = new Set(); // collapse duplicate member rows within one sheet

    rows.forEach((raw, i) => {
      const rowNum = (raw && raw.__row) || (i + 1);
      const name = typeof (raw && raw.name) === 'string' ? raw.name.trim() : '';
      // Points: blank/0/non-number => skip (coaches only fill some rows).
      const rawPts = raw == null ? '' : raw.points;
      if (rawPts === '' || rawPts == null) { return; } // truly blank, silent skip
      const points = Number(rawPts);
      if (!Number.isFinite(points) || !Number.isInteger(points)) {
        errors.push({ row: rowNum, name: name, reason: 'Points not a whole number (' + String(rawPts) + ')' });
        return;
      }
      if (points === 0) { skippedBlank.push({ row: rowNum, name: name }); return; }
      if (Math.abs(points) > 1000) { errors.push({ row: rowNum, name: name, reason: 'Out of range (max ±1000)' }); return; }

      // Resolve the member id.
      let id = typeof (raw && raw.member_id) === 'string' ? raw.member_id.trim() : '';
      if (id && (!UUID_RE.test(id) || !idSet.has(id))) {
        errors.push({ row: rowNum, name: name, reason: 'Member ID not found in this club' });
        return;
      }
      if (!id) {
        if (!name) { errors.push({ row: rowNum, name: '', reason: 'No member ID and no name' }); return; }
        const matches = nameMap[name.toLowerCase()] || [];
        if (matches.length === 0) { errors.push({ row: rowNum, name: name, reason: 'No member with that name' }); return; }
        if (matches.length > 1) { errors.push({ row: rowNum, name: name, reason: 'Name matches ' + matches.length + ' members - add the Member ID' }); return; }
        id = matches[0];
      }

      if (seen.has(id)) { errors.push({ row: rowNum, name: name, reason: 'Member appears twice in the sheet' }); return; }
      seen.add(id);
      toInsert.push({ member_id: id, points: points });
    });

    if (!toInsert.length) {
      return res.status(200).json({ ok: true, applied: 0, total_points: 0, skipped_blank: skippedBlank.length, errors: errors });
    }

    // Duplicate guard: have any of these members already received this exact label?
    if (!force) {
      const ids = toInsert.map(r => r.member_id);
      const { data: dupes } = await db.from('point_awards')
        .select('member_id').eq('reason', reason).in('member_id', ids);
      if (dupes && dupes.length) {
        return res.status(200).json({
          ok: false,
          needs_confirm: true,
          duplicate_count: dupes.length,
          reason_label: reason,
          ready: toInsert.length,
          message: dupes.length + ' of these members already have points logged under "' + reason + '". Uploading again will add the points on top. Confirm to proceed.'
        });
      }
    }

    const payload = toInsert.map(r => ({ member_id: r.member_id, points: r.points, reason: reason, awarded_by: user.id }));
    const { error: insErr } = await db.from('point_awards').insert(payload);
    if (insErr) return res.status(500).json({ error: insErr.message });

    const totalPoints = toInsert.reduce((a, r) => a + r.points, 0);
    return res.status(200).json({
      ok: true,
      applied: toInsert.length,
      total_points: totalPoints,
      reason_label: reason,
      skipped_blank: skippedBlank.length,
      errors: errors
    });
  } catch (e) {
    console.error('[/api/admin/import-points]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
