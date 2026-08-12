// POST /api/admin/lead-touch - admin only. Records a chase action on one lead so the
// Leads tab can track New / Contacted / Won / Lost / Snoozed and resurface follow-ups.
//
// Body: { lead_key, status, note?, snooze_until?, snooze_days?, member_id? }
//   status       one of new|contacted|won|lost|snoozed
//   note         optional. Omit it to keep whatever note is already saved; send a
//                string to overwrite it, or an empty string to clear it. A plain
//                status change must never wipe the admin's context note.
//   snooze_until when status=snoozed, the date to chase them again (YYYY-MM-DD).
//                Preferred: the admin picks a real date and it comes back that
//                morning, not at whatever hour they happened to tap snooze.
//   snooze_days  fallback when no date is given. Days until it resurfaces
//                (default 3). Kept so any older caller keeps working.
//
// Idempotent upsert keyed on lead_key. Degrades gracefully: if the lead_touch table
// hasn't been migrated yet, returns a clear error instead of a 500 stack.
const { admin, getUser, isAdmin } = require('../_lib');

const VALID = ['new', 'contacted', 'won', 'lost', 'snoozed'];
// Two years is well past any real follow-up and still stops a fat-fingered year
// from parking a lead until 2085.
const MAX_DAYS = 730;

// When the snooze ends. A picked date resurfaces the lead at 04:00 UTC, which is
// 8am in Dubai: it is waiting in the chase list when Ahmed starts his day rather
// than appearing at whatever hour he tapped snooze. Falls back to a day count.
function snoozeUntil(body) {
  const raw = typeof body.snooze_until === 'string' ? body.snooze_until.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const at = Date.parse(raw + 'T04:00:00Z');
    if (!Number.isFinite(at)) return null;
    const capped = Math.min(at, Date.now() + MAX_DAYS * 86400000);
    // A date already past would resurface instantly, which is not a snooze.
    return capped > Date.now() ? new Date(capped).toISOString() : null;
  }
  const days = Math.max(1, Math.min(MAX_DAYS, Number(body.snooze_days) || 3));
  return new Date(Date.now() + days * 86400000).toISOString();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  const body = req.body || {};
  const lead_key = typeof body.lead_key === 'string' ? body.lead_key.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!lead_key) return res.status(400).json({ error: 'lead_key required' });
  if (VALID.indexOf(status) === -1) return res.status(400).json({ error: 'Invalid status' });

  const row = {
    lead_key,
    status,
    updated_by: user.email || user.id,
    updated_at: new Date().toISOString(),
    snooze_until: null,
    member_id: lead_key.indexOf('m:') === 0 ? lead_key.slice(2) : (body.member_id || null)
  };
  // Only touch the note column when the caller actually sent one. Leaving the key out
  // of the upsert payload means PostgREST never writes it, so the saved note survives.
  if (typeof body.note === 'string') row.note = body.note.slice(0, 500).trim() || null;
  if (status === 'snoozed') {
    row.snooze_until = snoozeUntil(body);
    if (!row.snooze_until) return res.status(400).json({ error: 'Pick a snooze date in the future.' });
  }

  try {
    const { error } = await db.from('lead_touch').upsert(row, { onConflict: 'lead_key' });
    if (error) {
      if (/relation .*lead_touch.* does not exist/i.test(error.message) || error.code === '42P01') {
        return res.status(503).json({ error: 'Lead tracking not migrated yet. Run the lead_touch migration.' });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true, lead_key, status, snooze_until: row.snooze_until });
  } catch (e) {
    console.error('[/api/admin/lead-touch]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
