// ManyChat helper for LFG Dubai (Instagram DM bot, Ahmed's ManyChat Pro workspace).
//
// One job: when a booking that STARTED from an Instagram DM link completes, tag the
// ManyChat subscriber so Ahmed's flows skip the "did you book?" follow-up and send a
// thank-you instead. DM links carry ?mc_id=<subscriber id>; the pages pass it to the
// API; the API passes it here.
//
// SAFETY CONTRACT:
//   * Never throws and never blocks a booking - every caller gets { ok, reason }.
//   * MANYCHAT_API_KEY unset or MANYCHAT_DISABLED=true  ->  no-op (logged, not an error).
//   * Only ever ADDS one of two tags (booked-run, booked-bootcamp). Never removes,
//     never messages, never reads subscriber data.
//   * 5 second timeout; a slow or down ManyChat costs the booking nothing.
//   * Subscriber ids are validated (digits only) before they reach the network.

const BASE = 'https://api.manychat.com';
const TAGS = { run: 'booked-run', bootcamp: 'booked-bootcamp' };
const TIMEOUT_MS = 5000;

function isEnabled() {
  return process.env.MANYCHAT_DISABLED !== 'true' && !!process.env.MANYCHAT_API_KEY;
}

// ManyChat subscriber ids are numeric. Anything else is dropped before use.
function cleanMcId(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{1,20}$/.test(s) ? s : null;
}

async function mcPost(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.MANYCHAT_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Add `tagName` to subscriber `mcId`. Tries by name first; if ManyChat says the tag does
// not exist, creates it once and retries. Returns { ok, reason } - never throws.
async function tagSubscriber(mcId, tagName) {
  const id = cleanMcId(mcId);
  if (!id) return { ok: false, reason: 'invalid mc_id' };
  if (!Object.values(TAGS).includes(tagName)) {
    return { ok: false, reason: 'unknown tag' };
  }
  if (!isEnabled()) {
    console.log('[manychat] skipped (not configured): tag', tagName, 'subscriber', id);
    return { ok: false, reason: 'not configured' };
  }
  try {
    const payload = { subscriber_id: Number(id), tag_name: tagName };
    let r = await mcPost('/fb/subscriber/addTagByName', payload);
    if (r.status === 200 && r.data && r.data.status === 'success') return { ok: true };

    const msg = JSON.stringify((r.data && (r.data.message || r.data.details || r.data)) || '').toLowerCase();
    if (r.status >= 400 && r.status < 500 && /tag/.test(msg) && /(not found|doesn.t exist|does not exist|no such)/.test(msg)) {
      const c = await mcPost('/fb/page/createTag', { name: tagName });
      if (c.status === 200) {
        r = await mcPost('/fb/subscriber/addTagByName', payload);
        if (r.status === 200 && r.data && r.data.status === 'success') return { ok: true, created: true };
      }
    }
    console.warn('[manychat] tag failed:', tagName, 'subscriber', id, 'http', r.status, msg.slice(0, 200));
    return { ok: false, reason: 'http ' + r.status };
  } catch (e) {
    console.warn('[manychat] tag error:', tagName, 'subscriber', id, e && e.message);
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

module.exports = { TAGS, cleanMcId, tagSubscriber, isEnabled };
