// GET /api/admin/leads - admin only. The Leads CRM feed: every person worth chasing,
// each placed in exactly ONE money-priority bucket (no duplicate rows), scored by
// likelihood-to-convert, and merged with their follow-up status (lead_touch).
//
// Funnel: free Sunday run -> paid bootcamp. Buckets, hottest/most-money first:
//   A paid_not_in   : has unused credits, not booked the next session (cash already in)
//   B came_before   : attended 1+ bootcamp, no credits, not rebooked (proven buyer)
//   C ran_not_bought: showed up to 1+ run, never did a bootcamp (free->paid convert)
//   D signed_no_show: signed up for a run, never showed, never bootcamped (cold pipeline)
//   E no_contact    : record we can't reach (no WhatsApp, no email) -> data cleanup
//
// Each person resolves to the FIRST bucket they match (A>B>C>D>E), so no one appears twice.
const { admin, getUser, isAdmin } = require('../_lib');

const STAGE_LABEL = {
  A: 'Paid, not in', B: 'Came before', C: 'Ran, never bootcamped',
  D: 'Signed up, no-show', E: 'No contact'
};

function tempFor(score) { return score >= 65 ? 'hot' : (score >= 40 ? 'warm' : 'cold'); }

// Demographic "fit" - WHO the lead is, vs the behavioural score (WHAT they've done).
// Weights are grounded in LFG's own conversion data (free run -> paid bootcamp):
// working professionals convert ~19% and ages 25-39 ~20%, vs students ~5% and under-25 ~8%.
// Nationality is deliberately NOT scored: in our data it just proxies age/occupation, and
// scoring people by nationality is a discrimination/optics risk. Revisit as the sample grows.
const OCC_FIT = { working_pro: 12, freelancer: 6, other: 6, business_owner: 4, student: -2, visiting: -6 };
function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob); if (isNaN(d.getTime())) return null;
  const n = new Date(); let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return (a >= 10 && a <= 100) ? a : null;
}
function fitScore(occupation, age) {
  let f = 0;
  if (occupation && OCC_FIT[occupation] != null) f += OCC_FIT[occupation];
  if (age != null) {
    if (age >= 25 && age <= 39) f += 10;
    else if (age >= 40 && age <= 49) f += 3;
    else if (age >= 22 && age <= 24) f += 2;
    else if (age < 22) f -= 2;
  }
  return f;
}
function fitTier(f) { return f >= 14 ? 'high' : (f >= 5 ? 'med' : 'low'); }

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const db = admin();
  if (!(await isAdmin(db, user.id))) return res.status(403).json({ error: 'Admins only' });

  try {
    const now = Date.now();
    const startMs = s => Date.parse(s.session_date + 'T' + (s.start_time || '12:30:00') + '+04:00');

    const [sRes, bRes, pRes, mRes, rRes, raRes, payRes, touchRes] = await Promise.all([
      db.from('sessions').select('id,session_date,start_time,status').order('session_date', { ascending: true }),
      db.from('bookings').select('member_id,session_id,status,booked_at'),
      db.from('member_packages').select('member_id,sessions_remaining,status,expires_at'),
      db.from('members').select('id,full_name,email,created_at,is_admin'),
      db.from('run_registrations').select('member_id,first_name,last_name,email,whatsapp_e164,instagram_handle,nationality,occupation,date_of_birth,created_at'),
      db.from('run_attendance').select('member_id'),
      // Paid runs (real money in) - the strongest free->paid intent signal we have.
      db.from('payments').select('member_id,amount_aed,run_date').eq('kind', 'run').eq('status', 'paid').then(r => r, () => ({ data: [] })),
      // lead_touch may not exist yet (migration applied at deploy). Never let it break the feed.
      db.from('lead_touch').select('lead_key,status,note,snooze_until,updated_at').then(r => r, () => ({ data: [] }))
    ]);

    const sess = sRes.data || [];
    const upcoming = sess.filter(s => s.status === 'open' && (isNaN(startMs(s)) || startMs(s) >= now));
    const nextSession = upcoming[0] || null;
    const pastSess = sess.filter(s => !isNaN(startMs(s)) && startMs(s) < now);
    const lastSession = pastSess.length ? pastSess[pastSess.length - 1] : null;

    // ---- per-member rollups ----
    const M = {};
    const ensure = id => M[id] || (M[id] = { bcAttended: 0, bcBooked: 0, bookedNext: false, attendedLast: false, credits: 0, runs: 0, last: 0 });
    (bRes.data || []).forEach(b => {
      if (!b.member_id || b.status === 'cancelled') return;
      const e = ensure(b.member_id);
      e.bcBooked++;
      if (b.status === 'attended') e.bcAttended++;
      if (nextSession && b.session_id === nextSession.id) e.bookedNext = true;
      if (lastSession && b.session_id === lastSession.id && b.status === 'attended') e.attendedLast = true;
      const t = Date.parse(b.booked_at || '') || 0;
      if (t > e.last) e.last = t;
    });
    (pRes.data || []).forEach(p => {
      if (p.status === 'active' && p.sessions_remaining > 0 && new Date(p.expires_at).getTime() > now) {
        ensure(p.member_id).credits += p.sessions_remaining;
      }
    });
    (raRes.data || []).forEach(r => { if (r.member_id) ensure(r.member_id).runs++; });

    // Paid-run rollup per member: how many runs they paid for, total AED, most recent paid run.
    const payBy = {};
    (payRes.data || []).forEach(p => {
      if (!p.member_id) return;
      const e = payBy[p.member_id] || (payBy[p.member_id] = { count: 0, aed: 0, last: null });
      e.count++; e.aed += Number(p.amount_aed) || 0;
      if (p.run_date && (!e.last || p.run_date > e.last)) e.last = p.run_date;
    });

    // Contact + identity for members: pull the best run_registration row (has WhatsApp/nationality).
    // Members and their run signups often DON'T share a member_id or email (someone signs up for a
    // run with one email and makes an account with another). So we also index by normalised name as
    // a last-resort match, preferring a row that actually carries a WhatsApp number.
    const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const regByMember = {}, regByEmail = {}, regByName = {};
    const betterReg = (a, b) => {
      if (!a) return b; if (!b) return a;
      const aw = a.whatsapp_e164 ? 1 : 0, bw = b.whatsapp_e164 ? 1 : 0;
      if (aw !== bw) return aw > bw ? a : b;                      // prefer the row with a number
      return (a.created_at || '') >= (b.created_at || '') ? a : b; // then the most recent
    };
    (rRes.data || []).forEach(r => {
      if (r.member_id) regByMember[r.member_id] = betterReg(regByMember[r.member_id], r);
      if (r.email) { const k = r.email.toLowerCase(); regByEmail[k] = betterReg(regByEmail[k], r); }
      const nm = normName((r.first_name || '') + ' ' + (r.last_name || ''));
      if (nm.indexOf(' ') > -1) regByName[nm] = betterReg(regByName[nm], r); // 2+ word names only, low collision
    });
    const memBy = {}, memEmail = {}, memNameSet = {};
    (mRes.data || []).forEach(m => {
      memBy[m.id] = m;
      if (m.email) memEmail[m.email.toLowerCase()] = m;
      const nm = normName(m.full_name);
      if (nm.indexOf(' ') > -1) memNameSet[nm] = true;
    });

    const touchBy = {};
    (touchRes.data || []).forEach(t => { touchBy[t.lead_key] = t; });

    const digits = s => String(s || '').replace(/[^\d]/g, '');
    const out = [];

    // ---------- MEMBERS ----------
    (mRes.data || []).filter(m => !m.is_admin).forEach(m => {
      const e = M[m.id] || ensure(m.id);
      if (e.bookedNext) return; // already in for the next session - not a lead
      const nmKey = normName(m.full_name);
      const reg = regByMember[m.id] || regByEmail[(m.email || '').toLowerCase()] || (nmKey.indexOf(' ') > -1 ? regByName[nmKey] : null) || {};
      const whatsapp = reg.whatsapp_e164 || null;
      const instagram = reg.instagram_handle || null;
      const email = m.email || reg.email || null;
      const registeredRun = !!(regByMember[m.id] || regByEmail[(m.email || '').toLowerCase()] || (nmKey.indexOf(' ') > -1 && regByName[nmKey]));

      const pay = payBy[m.id] || { count: 0, aed: 0, last: null };

      let stage = null, chips = [];
      if (e.credits > 0) { stage = 'A'; if (e.bcAttended === 1) chips.push('came_once'); else if (e.bcAttended >= 2) chips.push('regular'); }
      else if (e.bcAttended >= 1) { stage = 'B'; chips.push(e.bcAttended >= 2 ? 'regular' : 'came_once'); }
      else if (e.runs >= 1 || pay.count >= 1) { stage = 'C'; } // showed up to, OR paid for, a run - never bootcamped
      else if (registeredRun) { stage = 'D'; }
      else return; // member with an account but zero activity and no credits - not a chase lead
      if (pay.count >= 1) chips.push('paid_run'); // proven spender - warmest free->paid target
      if (lastSession && e.bcAttended >= 1 && !e.attendedLast) chips.push('skipped_last');
      if (!whatsapp && !email) stage = 'E';

      // A paid run counts as real recent activity even if they never checked in / filled the form.
      const last = e.last || (pay.last ? Date.parse(pay.last + 'T12:00:00') : 0) || Date.parse(reg.created_at || m.created_at || '') || now;
      const daysSince = Math.floor((now - last) / 86400000);
      out.push(buildLead({
        lead_key: 'm:' + m.id, member_id: m.id,
        name: m.full_name || reg.first_name || (email || '').split('@')[0] || 'Member',
        first_name: reg.first_name || (m.full_name || '').split(' ')[0] || 'there',
        email, whatsapp, instagram, nationality: reg.nationality || null,
        occupation: reg.occupation || null, age: ageFrom(reg.date_of_birth),
        runs: e.runs, bootcamps: e.bcAttended, credits: e.credits,
        paidRuns: pay.count, paidAed: pay.aed, lastPaidRun: pay.last,
        stage, chips, daysSince, last, touch: touchBy['m:' + m.id]
      }));
    });

    // ---------- GUEST run signups (no account, email not a member) ----------
    const seenGuest = {};
    (rRes.data || []).forEach(r => {
      if (r.member_id) return;                                   // linked to an account -> handled above
      const emailKey = (r.email || '').toLowerCase();
      if (emailKey && memEmail[emailKey]) return;                // same human already a member -> dedup
      const rNm = normName((r.first_name || '') + ' ' + (r.last_name || ''));
      if (rNm.indexOf(' ') > -1 && memNameSet[rNm]) return;      // name matches a member -> dedup (Omar case)
      const key = emailKey ? 'e:' + emailKey : (digits(r.whatsapp_e164) ? 'w:' + digits(r.whatsapp_e164) : null);
      if (key && seenGuest[key]) return; seenGuest[key || ('row:' + Math.random())] = true;

      const whatsapp = r.whatsapp_e164 || null, email = r.email || null;
      const instagram = r.instagram_handle || null;
      const stage = (!whatsapp && !email) ? 'E' : 'D';
      const last = Date.parse(r.created_at || '') || now;
      out.push(buildLead({
        lead_key: key || ('e:' + emailKey), member_id: null,
        name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || (email || '').split('@')[0] || 'Runner',
        first_name: r.first_name || 'there',
        email, whatsapp, instagram, nationality: r.nationality || null,
        occupation: r.occupation || null, age: ageFrom(r.date_of_birth),
        runs: 0, bootcamps: 0, credits: 0,
        stage, chips: [], daysSince: Math.floor((now - last) / 86400000), last,
        touch: key ? touchBy[key] : null
      }));
    });

    // Won / lost / still-snoozed leads come off the active chase list, but they are
    // returned separately rather than dropped, so the Leads tab can filter back to
    // them. Without this a mis-tapped "Lost" hid someone permanently.
    const isArchived = l => {
      const st = l.touch && l.touch.status;
      if (st === 'won' || st === 'lost') return true;
      if (st === 'snoozed' && l.touch.snooze_until && Date.parse(l.touch.snooze_until) > now) return true;
      return false;
    };
    const active = out.filter(l => !isArchived(l));
    const archived = out.filter(isArchived);
    active.sort((a, b) => b.score - a.score || b.credits - a.credits);
    // Most recently actioned first - that's the one you're most likely looking for.
    archived.sort((a, b) => Date.parse((b.touch && b.touch.updated_at) || 0) - Date.parse((a.touch && a.touch.updated_at) || 0));

    const byStage = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    const byTemp = { hot: 0, warm: 0, cold: 0 };
    let creditsOutstanding = 0, paidRunLeads = 0;
    active.forEach(l => { byStage[l.stage]++; byTemp[l.temperature]++; creditsOutstanding += (l.stage === 'A' ? l.credits : 0); if (l.paid_runs > 0) paidRunLeads++; });

    return res.status(200).json({
      leads: active,
      archived,
      next_session: nextSession ? nextSession.session_date : null,
      next_label: nextSession ? new Date(nextSession.session_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) : 'the next session',
      last_session: lastSession ? lastSession.session_date : null,
      summary: {
        total: active.length,
        credits_sessions_outstanding: creditsOutstanding,
        warm_plus: byTemp.hot + byTemp.warm,
        convertible: byStage.C,
        paid_run_leads: paidRunLeads,
        by_stage: byStage,
        by_temp: byTemp
      }
    });
  } catch (e) {
    console.error('[/api/admin/leads]', e);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Score a lead 0-100 from the signals we track, then attach a temperature + labels.
function buildLead(x) {
  let score = 0;
  if (x.credits > 0) score += 35 + Math.min(x.credits, 10);     // already paid: warmest
  if (x.bootcamps >= 2) score += 30; else if (x.bootcamps === 1) score += 20; // proven buyer
  if ((x.paidRuns || 0) >= 1 && x.bootcamps === 0) score += 25 + Math.min((x.paidRuns || 1) - 1, 5) * 3; // paid for a run, not bootcamped yet: hottest upsell
  else if (x.runs >= 1 && x.bootcamps === 0) score += 18;      // free->paid convert target
  if (x.runs >= 2) score += 5;
  if (x.chips.indexOf('skipped_last') > -1) score += 10;        // urgency: catch before they drift
  if (x.daysSince <= 14) score += 10;
  else if (x.daysSince <= 30) score += 5;
  else score -= Math.min(15, Math.floor(x.daysSince / 30) * 5); // decay the longer they're quiet
  if (x.whatsapp) score += 10; else if (x.email) score += 4;
  const fit = fitScore(x.occupation, x.age);                     // who they are (demographic fit)
  score += fit;                                                  // surface good-fit people higher in the list
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!x.whatsapp && !x.email) score = Math.min(score, 12);     // can't sell to a ghost

  return {
    lead_key: x.lead_key, member_id: x.member_id,
    name: x.name, first_name: x.first_name, email: x.email, whatsapp: x.whatsapp,
    instagram: x.instagram || null, nationality: x.nationality,
    occupation: x.occupation || null, age: x.age != null ? x.age : null,
    fit, fit_tier: fitTier(fit),
    runs: x.runs, bootcamps: x.bootcamps, credits: x.credits,
    paid_runs: x.paidRuns || 0, paid_aed: x.paidAed || 0, last_paid_run: x.lastPaidRun || null,
    stage: x.stage, stage_label: STAGE_LABEL[x.stage], chips: x.chips,
    score, temperature: tempFor(score),
    days_quiet: x.daysSince,
    last_activity: new Date(x.last).toISOString().slice(0, 10),
    touch: x.touch ? { status: x.touch.status, note: x.touch.note || '', snooze_until: x.touch.snooze_until || null, updated_at: x.touch.updated_at } : { status: 'new', note: '', snooze_until: null }
  };
}
