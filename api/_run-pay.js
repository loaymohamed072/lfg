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

module.exports = { memberPaidForRun };
