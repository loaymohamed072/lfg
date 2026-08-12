// End-to-end test for the GHL integration helper.
// Uses a clearly-fake email so any contact that lands in GHL is obviously test data.
//
//   node --env-file=.env scripts/test-ghl.js
//
// Respects GHL_DRY_RUN — when true, prints intended payloads without writing.
// When false, actually pushes to GHL (the test email makes it easy to find + delete).

const ghl = require('../api/_ghl');

const STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const TEST_EMAIL = `lfg-integration-test-${STAMP}@example.com`;
const TEST_FIRST = 'Integration';
const TEST_LAST = `Test ${STAMP}`;
// Unique phone per test run so GHL's phone-dedupe doesn't collide across tests.
// Last 7 digits = last 7 of Date.now() padded to ensure UAE mobile format (+971 5x).
const TEST_PHONE = '+971' + ('5' + String(Date.now()).slice(-8)).slice(0, 9);

function hr(s) { console.log('\n=== ' + s + ' ==='); }

(async () => {
  console.log('GHL integration test');
  console.log('  Mode:        ' + (ghl.isDryRun() ? 'DRY RUN (no writes)' : 'LIVE WRITE (will hit GHL)'));
  console.log('  Enabled:     ' + ghl.isEnabled());
  console.log('  Test email:  ' + TEST_EMAIL);

  if (!ghl.isEnabled()) {
    console.error('GHL is disabled or env vars missing. Aborting.');
    process.exit(1);
  }

  hr('Load resources (read-only)');
  const r = await ghl.loadResources();
  console.log('  tags loaded:          ' + Object.keys(r.tags || {}).length);
  console.log('  custom fields loaded: ' + Object.keys(r.customFields || {}).length);
  console.log('  pipelines loaded:     ' + Object.keys(r.pipelines || {}).join(', '));

  hr('Simulated: run RSVP');
  await ghl.onRunRegister({
    email: TEST_EMAIL,
    firstName: TEST_FIRST,
    lastName: TEST_LAST,
    whatsapp_e164: TEST_PHONE,
    level: 'beginner',
    hearSource: 'integration-test'
  });

  hr('Simulated: bootcamp purchase (AED 658, 8 credits)');
  await ghl.onBootcampPurchase({
    email: TEST_EMAIL,
    firstName: TEST_FIRST,
    lastName: TEST_LAST,
    amountAed: 658
  });

  hr('Simulated: coach marked attended Sunday bootcamp');
  await ghl.onAttendance({
    email: TEST_EMAIL,
    firstName: TEST_FIRST,
    lastName: TEST_LAST,
    kind: 'bootcamp'
  });

  hr('Done');
  if (ghl.isDryRun()) {
    console.log('DRY RUN complete. Nothing was written to GHL.');
    console.log('Review the payloads above. If they look right, flip GHL_DRY_RUN=false in .env and re-run for a live test.');
  } else {
    console.log('LIVE write complete.');
    console.log('Open GHL → LFG Dubai → Contacts and search for ' + TEST_EMAIL);
    console.log('You should see ONE contact with tags + custom fields, and ONE opp in "LFG Community" at "Attended Bootcamp" stage worth 658 AED.');
    console.log('Delete that contact + opp by hand in the GHL UI when done verifying.');
  }
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
