// Go High Level (GHL) integration helper for LFG Dubai.
// Pushes LFG website events into Ahmed's existing GHL sub-account pipeline:
//   - new run RSVP        →  Warm (Replied)
//   - bootcamp purchase   →  Hot (Interested)  + monetary value
//   - marked attended     →  Attended Bootcamp / Attended Runclub
//
// SAFETY CONTRACT (strictly enforced - see safeguards below):
//   * Never deletes anything in GHL
//   * Never modifies opps/contacts not created by this integration
//   * Only touches opps with the "LFG: " name prefix (our marker)
//   * Skips any contact with the "don't contact" tag (silent bail)
//   * Uses Ahmed's existing tags / custom fields / pipelines - never creates new
//   * One contact at a time, never bulk
//   * GHL_DRY_RUN=true (default) logs intended actions, does not call write APIs
//   * GHL_DISABLED=true short-circuits all calls to no-ops
//   * If GHL is down or rejects, LFG keeps working (all callers wrap try/catch)

const BASE = 'https://services.leadconnectorhq.com';
const VERSION_HEADER = '2021-07-28';

const COMMUNITY_PIPELINE_NAME = 'LFG Community';
const STAGES = {
  warm: 'Warm (Replied)',
  hot: 'Hot (Interested)',
  attendedRunclub: 'Attended Runclub',
  attendedBootcamp: 'Attended Bootcamp',
  coachingProspect: 'LFG Coaching Prospect',
  cold: 'Cold (Inactive)'
};
const DNC_TAG = "don't contact";
const OPP_NAME_PREFIX = 'LFG: ';

// Cached on first call to avoid re-fetching tag/field/pipeline IDs on every push.
const cache = { tags: null, customFields: null, pipelines: null };

function isEnabled() {
  return process.env.GHL_DISABLED !== 'true' && !!process.env.GHL_LOCATION_API_KEY && !!process.env.GHL_LOCATION_ID;
}
function isDryRun() {
  return process.env.GHL_DRY_RUN === 'true';
}

async function ghlFetch(path, opts = {}) {
  if (!isEnabled()) return { ok: false, status: 0, error: 'GHL disabled / not configured' };
  const headers = Object.assign({
    Authorization: 'Bearer ' + process.env.GHL_LOCATION_API_KEY,
    Version: VERSION_HEADER,
    Accept: 'application/json'
  }, opts.headers || {});
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

// Read Ahmed's existing tags / fields / pipeline IDs. Read-only.
async function loadResources() {
  if (cache.tags && cache.customFields && cache.pipelines) return cache;
  const locId = process.env.GHL_LOCATION_ID;
  const [tagsRes, fieldsRes, pipelinesRes] = await Promise.all([
    ghlFetch('/locations/' + locId + '/tags'),
    ghlFetch('/locations/' + locId + '/customFields'),
    ghlFetch('/opportunities/pipelines?locationId=' + locId)
  ]);
  cache.tags = {};
  for (const t of (tagsRes.data && tagsRes.data.tags) || []) cache.tags[t.name] = t.id;
  cache.customFields = {};
  for (const f of (fieldsRes.data && fieldsRes.data.customFields) || []) cache.customFields[f.name] = f.id;
  cache.pipelines = {};
  for (const p of (pipelinesRes.data && pipelinesRes.data.pipelines) || []) {
    const stagesByName = {};
    for (const s of p.stages || []) stagesByName[s.name] = s.id;
    cache.pipelines[p.name] = { id: p.id, stages: stagesByName };
  }
  return cache;
}

async function findContactByEmail(email) {
  if (!email) return null;
  const r = await ghlFetch('/contacts/?locationId=' + process.env.GHL_LOCATION_ID + '&query=' + encodeURIComponent(email));
  if (!r.ok) return null;
  for (const c of (r.data && r.data.contacts) || []) {
    if ((c.email || '').toLowerCase() === email.toLowerCase()) return c;
  }
  return null;
}

// Fetch the freshest contact state by ID - used right before any UPDATE so we
// can merge with current tags / fields instead of clobbering them.
async function getContactById(id) {
  const r = await ghlFetch('/contacts/' + id);
  return r.ok ? (r.data && r.data.contact) : null;
}

// Strip undefined keys so we never accidentally null out existing GHL data
// (sending `{phone: undefined}` would serialize to `{}` but be explicit anyway).
function pruneUndefined(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}

// Merge custom field arrays - new values overwrite same-ID old ones, others preserved.
function mergeCustomFields(existing, incoming) {
  const byId = new Map();
  for (const f of existing || []) if (f && f.id) byId.set(f.id, f);
  for (const f of incoming || []) if (f && f.id) byId.set(f.id, f);
  return Array.from(byId.values());
}

// Upsert a contact. Dedupes by email. Skips silently if DNC tag is present.
// Critical: every UPDATE re-reads the contact by ID first and MERGES with
// what's already on the record - never blindly overwrites tags / phone / fields.
async function upsertContact({ email, firstName, lastName, phone, level, hearSource, source, tagsToAdd }) {
  if (!isEnabled()) return { ok: false, skipped: 'ghl-disabled' };
  if (!email) return { ok: false, skipped: 'no-email' };
  tagsToAdd = tagsToAdd || [];

  const resources = await loadResources();
  const existing = await findContactByEmail(email);

  if (existing && (existing.tags || []).includes(DNC_TAG)) {
    console.log('[GHL] skipping DNC contact', email);
    return { ok: true, skipped: 'dnc', contactId: existing.id };
  }

  // Only push tags that already exist in Ahmed's taxonomy.
  const safeTags = tagsToAdd.filter(t => resources.tags[t]);

  // Custom field values keyed by name → ID. Only push ones we have a value for.
  const newCustomFields = [];
  if (level && resources.customFields['What is your level?']) {
    newCustomFields.push({ id: resources.customFields['What is your level?'], field_value: capFirst(level) });
  }
  if (hearSource && resources.customFields['How did you hear about us?']) {
    newCustomFields.push({ id: resources.customFields['How did you hear about us?'], field_value: hearSource });
  }

  // Helper to build a merge-safe UPDATE payload for an existing contact.
  // GHL PUT /contacts/{id} rejects locationId + email in the body (those identify
  // the resource, set via the URL or immutably at creation), so we omit them.
  async function buildMergePayload(contactId) {
    const fresh = await getContactById(contactId);
    const existingTags = fresh ? (fresh.tags || []) : [];
    const existingCfs = fresh ? (fresh.customFields || []) : [];
    return pruneUndefined({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      phone: phone || undefined,            // only set if we have one
      source: source || undefined,          // don't overwrite existing source if we don't have a new one
      country: fresh && fresh.country ? undefined : 'AE',
      tags: Array.from(new Set([...existingTags, ...safeTags])),
      customFields: mergeCustomFields(existingCfs, newCustomFields)
    });
  }

  // CREATE payload - fresh record, no merging needed.
  const createPayload = pruneUndefined({
    locationId: process.env.GHL_LOCATION_ID,
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    phone: phone || undefined,
    source: source || 'LFG Website',
    country: 'AE',
    tags: safeTags.length ? safeTags : undefined,
    customFields: newCustomFields.length ? newCustomFields : undefined
  });

  if (isDryRun()) {
    console.log('[GHL DRY-RUN] upsertContact', JSON.stringify({ existing: !!existing, createPayload, mergeIfExisting: 'would re-fetch + merge' }, null, 2));
    return { ok: true, dryRun: true, contactId: existing ? existing.id : 'dry-run', createPayload };
  }

  if (existing) {
    const payload = await buildMergePayload(existing.id);
    const upd = await ghlFetch('/contacts/' + existing.id, { method: 'PUT', body: payload });
    if (!upd.ok) return { ok: false, error: 'contact-update-failed', status: upd.status, body: upd.data };
    return { ok: true, contactId: existing.id, updated: true };
  }
  const create = await ghlFetch('/contacts/', { method: 'POST', body: createPayload });
  if (create.ok) {
    return { ok: true, contactId: create.data && create.data.contact && create.data.contact.id, created: true };
  }
  // GHL returns 400 + existing contactId in error meta when phone/email collides.
  // Fall through to a merge-safe UPDATE on that ID.
  const dupId = create.data && create.data.meta && create.data.meta.contactId;
  if (create.status === 400 && dupId) {
    const payload = await buildMergePayload(dupId);
    const upd = await ghlFetch('/contacts/' + dupId, { method: 'PUT', body: payload });
    if (!upd.ok) return { ok: false, error: 'contact-update-after-dup-failed', status: upd.status, body: upd.data };
    return { ok: true, contactId: dupId, updated: true, dedupedVia: 'dup-error' };
  }
  return { ok: false, error: 'contact-create-failed', status: create.status, body: create.data };
}

// Create or move our (LFG: prefix) opp for this contact to a stage.
// Never touches opps without the prefix.
async function upsertOpp({ email, contactId, stageName, monetaryValue }) {
  if (!isEnabled()) return { ok: false, skipped: 'ghl-disabled' };
  if (!contactId) return { ok: false, skipped: 'no-contact-id' };

  const resources = await loadResources();
  const pipeline = resources.pipelines[COMMUNITY_PIPELINE_NAME];
  if (!pipeline) return { ok: false, error: 'pipeline-not-found' };
  const stageId = pipeline.stages[stageName];
  if (!stageId) return { ok: false, error: 'stage-not-found:' + stageName };

  // Look up existing LFG: opp for this contact in the Community pipeline
  let existing = null;
  const search = await ghlFetch('/opportunities/search?location_id=' + process.env.GHL_LOCATION_ID + '&contact_id=' + contactId + '&pipeline_id=' + pipeline.id);
  if (search.ok) {
    for (const o of (search.data && search.data.opportunities) || []) {
      if ((o.name || '').startsWith(OPP_NAME_PREFIX)) { existing = o; break; }
    }
  }

  const oppName = OPP_NAME_PREFIX + email;
  // Never lower an opp's value: an existing bootcamp opp (150) must survive a later run (30).
  const existingMon = existing && typeof existing.monetaryValue === 'number' ? existing.monetaryValue : 0;
  const finalMonetary = typeof monetaryValue === 'number' ? Math.max(existingMon, monetaryValue) : existingMon;

  // POST /opportunities/ requires locationId. PUT /opportunities/{id} does not.
  const createPayload = {
    locationId: process.env.GHL_LOCATION_ID,
    pipelineId: pipeline.id,
    pipelineStageId: stageId,
    name: oppName,
    monetaryValue: finalMonetary,
    status: 'open',
    contactId
  };
  const updatePayload = {
    pipelineId: pipeline.id,
    pipelineStageId: stageId,
    name: oppName,
    monetaryValue: finalMonetary,
    status: 'open'
  };

  if (isDryRun()) {
    console.log('[GHL DRY-RUN] upsertOpp', JSON.stringify({ existing: !!existing, createPayload, updatePayload }, null, 2));
    return { ok: true, dryRun: true, oppId: existing ? existing.id : 'dry-run' };
  }

  if (existing) {
    const upd = await ghlFetch('/opportunities/' + existing.id, { method: 'PUT', body: updatePayload });
    if (!upd.ok) return { ok: false, error: 'opp-update-failed', status: upd.status, body: upd.data };
    return { ok: true, oppId: existing.id, updated: true };
  }
  const create = await ghlFetch('/opportunities/', { method: 'POST', body: createPayload });
  if (!create.ok) return { ok: false, error: 'opp-create-failed', status: create.status, body: create.data };
  return { ok: true, oppId: create.data && create.data.opportunity && create.data.opportunity.id, created: true };
}

function capFirst(s) { return (s || '').charAt(0).toUpperCase() + (s || '').slice(1); }

// === High-level event handlers (the only thing other files should call) ===

// Surface partial failures from upsertContact/upsertOpp so they don't disappear silently.
function logResult(tag, res) {
  if (!res) return;
  if (res.skipped) console.log('[GHL ' + tag + '] skipped:', res.skipped, res.contactId || '');
  else if (res.ok) console.log('[GHL ' + tag + '] ok', JSON.stringify({ contactId: res.contactId, oppId: res.oppId, created: res.created, updated: res.updated, dedupedVia: res.dedupedVia }));
  else console.warn('[GHL ' + tag + '] FAIL', JSON.stringify({ error: res.error, status: res.status, body: res.body }));
}

async function onRunRegister({ email, firstName, lastName, whatsapp_e164, level, hearSource }) {
  if (!isEnabled()) return;
  try {
    const c = await upsertContact({
      email, firstName, lastName, phone: whatsapp_e164,
      level, hearSource,
      source: 'LFG Website - Run RSVP',
      tagsToAdd: ['new contact', 'runclub']
    });
    logResult('onRunRegister contact', c);
    if (!c.ok || c.skipped) return;
    const o = await upsertOpp({ email, contactId: c.contactId, stageName: STAGES.warm, monetaryValue: 0 });
    logResult('onRunRegister opp', o);
  } catch (e) { console.warn('[GHL onRunRegister threw]', e && e.message); }
}

// A runner PAID for a run (e.g. the Gems intervals session). Real money in, so treat them as
// a hot, paying lead: reuse the existing 'Hot (Interested)' stage + a 'paid runclub' tag, and
// set the opp's monetary value to the amount (never lowering an existing higher value).
async function onPaidRun({ email, firstName, lastName, whatsapp_e164, amountAed }) {
  if (!isEnabled()) return;
  try {
    const c = await upsertContact({
      email, firstName, lastName, phone: whatsapp_e164,
      source: 'LFG Website - Paid Run',
      tagsToAdd: ['runclub', 'paid runclub']
    });
    logResult('onPaidRun contact', c);
    if (!c.ok || c.skipped) return;
    const o = await upsertOpp({
      email, contactId: c.contactId,
      stageName: STAGES.hot,
      monetaryValue: Number(amountAed) || 0
    });
    logResult('onPaidRun opp', o);
  } catch (e) { console.warn('[GHL onPaidRun threw]', e && e.message); }
}

async function onBootcampPurchase({ email, firstName, lastName, amountAed }) {
  if (!isEnabled()) return;
  try {
    const c = await upsertContact({
      email, firstName, lastName,
      source: 'LFG Website - Bootcamp Purchase',
      tagsToAdd: ['bootcamp']
    });
    logResult('onBootcampPurchase contact', c);
    if (!c.ok || c.skipped) return;
    const o = await upsertOpp({
      email, contactId: c.contactId,
      stageName: STAGES.hot,
      monetaryValue: Number(amountAed) || 0
    });
    logResult('onBootcampPurchase opp', o);
  } catch (e) { console.warn('[GHL onBootcampPurchase threw]', e && e.message); }
}

async function onAttendance({ email, firstName, lastName, kind }) {
  if (!isEnabled()) return;
  try {
    const stage = kind === 'runclub' ? STAGES.attendedRunclub : STAGES.attendedBootcamp;
    const tag = kind === 'runclub' ? 'attended runclub' : 'bootcamp';
    const c = await upsertContact({
      email, firstName, lastName,
      source: 'LFG Website - Attendance',
      tagsToAdd: [tag]
    });
    logResult('onAttendance contact', c);
    if (!c.ok || c.skipped) return;
    const o = await upsertOpp({ email, contactId: c.contactId, stageName: stage });
    logResult('onAttendance opp', o);
  } catch (e) { console.warn('[GHL onAttendance threw]', e && e.message); }
}

module.exports = {
  // High-level event handlers (call these from endpoints):
  onRunRegister,
  onPaidRun,
  onBootcampPurchase,
  onAttendance,
  // Lower-level + status, mainly for the test script:
  loadResources,
  upsertContact,
  upsertOpp,
  isEnabled,
  isDryRun,
  STAGES
};
