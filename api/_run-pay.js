// Shared "has this member effectively paid for this run?" check, used by both the
// admin scanned-in board (api/admin/run-scans.js does the bulk version) and the
// runner-facing check-in nudge (api/run-checkin.js). Same rule everywhere so the
// two screens never disagree: a runner told "you're square" is never on the
// admin's owes list, and vice-versa.
//
// A member counts as paid if ANY of:
//   direct  - a paid run payment on their own member_id
//   host    - they're an admin (comped)
//   linked  - another member with the same normalised name OR same WhatsApp
//             (last 9 digits) paid for this run. Members routinely hold two
//             accounts, so member_id alone wrongly flags real payers - see the
//             2026-07-22 run where 2 of 4 "unpaid" scanners had paid on a
//             second account.
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normPhone = s => String(s || '').replace(/[^\d]/g, '').slice(-9);

// Returns { paid: bool, via: 'direct'|'host'|'linked'|null }.
async function memberPaidForRun(db, memberId, runDate) {
  if (!memberId || !runDate) return { paid: false, via: null };

  // 1. direct
  const { data: mine } = await db.from('payments')
    .select('id').eq('member_id', memberId).eq('kind', 'run').eq('run_date', runDate).eq('status', 'paid').limit(1);
  if (mine && mine.length) return { paid: true, via: 'direct' };

  // 2. host
  const { data: me } = await db.from('members').select('full_name, is_admin').eq('id', memberId).maybeSingle();
  if (me && me.is_admin) return { paid: true, via: 'host' };

  // 3. linked — only worth the extra queries if someone paid for this run at all.
  const { data: payers } = await db.from('payments')
    .select('member_id').eq('kind', 'run').eq('run_date', runDate).eq('status', 'paid');
  const payerIds = [...new Set((payers || []).map(p => p.member_id).filter(Boolean))];
  if (!payerIds.length) return { paid: false, via: null };

  const myName = normName(me && me.full_name);
  const { data: myReg } = await db.from('run_registrations')
    .select('whatsapp_e164').eq('member_id', memberId).not('whatsapp_e164', 'is', null).limit(1);
  const myPhone = normPhone(myReg && myReg[0] && myReg[0].whatsapp_e164);

  // Names of the payers.
  if (myName && myName.indexOf(' ') > -1) {
    const { data: payerMembers } = await db.from('members').select('id, full_name').in('id', payerIds);
    if ((payerMembers || []).some(pm => normName(pm.full_name) === myName)) return { paid: true, via: 'linked' };
  }
  // Phones of the payers.
  if (myPhone && myPhone.length >= 8) {
    const { data: payerRegs } = await db.from('run_registrations').select('whatsapp_e164').in('member_id', payerIds);
    if ((payerRegs || []).some(r => normPhone(r.whatsapp_e164) === myPhone)) return { paid: true, via: 'linked' };
  }
  return { paid: false, via: null };
}

// Bulk version of the same rule, for a whole run at once: three queries total
// instead of four per person, which is what a 5-second door poll needs. The order
// and the thresholds are identical to memberPaidForRun above (direct -> linked
// name -> linked phone -> host), so the door board and the runner nudge can never
// disagree about who owes.
//
// Also hands back the members it already loaded, so a caller that needs names
// doesn't fetch the table twice.
// Returns { members: { id: { id, full_name, is_admin } }, isPaid(memberId) -> bool }.
async function buildRunPaidIndex(db, runDate) {
  const [payRes, memRes, regRes] = await Promise.all([
    db.from('payments').select('member_id, status').eq('kind', 'run').eq('run_date', runDate),
    db.from('members').select('id, full_name, is_admin'),
    db.from('run_registrations').select('member_id, whatsapp_e164')
  ]);

  const members = {};
  (memRes.data || []).forEach(m => { members[m.id] = m; });

  // First row that carries a number wins, same as the admin board.
  const phoneByMember = {};
  (regRes.data || []).forEach(r => {
    if (r.member_id && r.whatsapp_e164 && !phoneByMember[r.member_id]) {
      phoneByMember[r.member_id] = normPhone(r.whatsapp_e164);
    }
  });

  const paidIds = new Set(), paidNames = new Set(), paidPhones = new Set();
  (payRes.data || []).forEach(p => {
    if (!p.member_id || p.status !== 'paid') return;
    paidIds.add(p.member_id);
    const nm = normName(members[p.member_id] && members[p.member_id].full_name);
    if (nm && nm.indexOf(' ') > -1) paidNames.add(nm);   // 2+ word names only
    const ph = phoneByMember[p.member_id];
    if (ph && ph.length >= 8) paidPhones.add(ph);
  });

  function isPaid(memberId) {
    if (paidIds.has(memberId)) return true;
    const m = members[memberId] || {};
    const nm = normName(m.full_name);
    if (nm && paidNames.has(nm)) return true;
    const ph = phoneByMember[memberId];
    if (ph && ph.length >= 8 && paidPhones.has(ph)) return true;
    return !!m.is_admin;
  }

  return { members, isPaid };
}

module.exports = { memberPaidForRun, buildRunPaidIndex };
