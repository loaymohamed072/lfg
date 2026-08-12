// One-shot verification for the latest test email
const ghl = require('../api/_ghl');
const EMAIL = process.argv[2];
if (!EMAIL) { console.error('usage: node scripts/_ghl-verify.js <email>'); process.exit(1); }

const TOKEN = process.env.GHL_LOCATION_API_KEY;
const LOC = process.env.GHL_LOCATION_ID;
const H = { Authorization: 'Bearer ' + TOKEN, Version: '2021-07-28', Accept: 'application/json' };

(async () => {
  const cs = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&query=${encodeURIComponent(EMAIL)}`, { headers: H }).then(r => r.json());
  const c = (cs.contacts || []).find(x => x.email === EMAIL);
  if (!c) { console.log('Contact NOT FOUND'); return; }
  console.log('=== CONTACT ===');
  console.log('  id     :', c.id);
  console.log('  name   :', c.firstName, c.lastName);
  console.log('  phone  :', c.phone);
  console.log('  source :', c.source);
  console.log('  tags   :', (c.tags||[]).sort().join(', '));
  console.log('  fields :', (c.customFields||[]).length);

  const os = await fetch(`https://services.leadconnectorhq.com/opportunities/search?location_id=${LOC}&contact_id=${c.id}&pipeline_id=IG5hkzFqWREPvRw3HCtv`, { headers: H }).then(r => r.json());
  const opps = (os.opportunities || []).filter(o => (o.name||'').startsWith('LFG: '));
  console.log('\n=== OPPS ===');
  if (!opps.length) console.log('  (none — opp creation failed silently in last test)');
  for (const o of opps) {
    console.log('  id            :', o.id);
    console.log('  name          :', o.name);
    console.log('  stage_id      :', o.pipelineStageId);
    console.log('  monetaryValue :', o.monetaryValue);
    console.log('  status        :', o.status);
  }
})();
