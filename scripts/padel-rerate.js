/**
 * Padel level re-rating, by hand.
 *
 *   node --env-file=.env scripts/padel-rerate.js          # dry run, prints the table
 *   node --env-file=.env scripts/padel-rerate.js --apply  # writes padel_profiles.level
 *
 * The same engine runs automatically when a night is ended from the admin
 * console. This is the way to see what it WOULD do before it does it, and the
 * way to re-rate the roster after correcting an old score. The rules and the
 * reasoning live in api/_padel-rating.js.
 */
const { admin } = require('../api/_lib');
const { computeLevels, applyLevels } = require('../api/_padel-rating');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = admin();
  const { nights, rows } = await computeLevels(db);

  const moving = rows.filter((r) => r.move !== 0);
  console.log('Nights replayed:', nights.join(', '));
  console.log(`Players rated: ${rows.length}   Levels changing: ${moving.length}\n`);

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('PLAYER', 26) + pad('MP', 4) + pad('NOW', 6) + pad('NEW', 6) + pad('MOVE', 7) + 'FLAG');
  for (const r of rows) {
    const flag = [r.overridden ? 'admin-set' : '', r.missingProfile ? 'no-profile' : '']
      .filter(Boolean)
      .join(' ');
    console.log(
      pad(r.name.slice(0, 25), 26) +
        pad(r.matches, 4) +
        pad(r.current.toFixed(1), 6) +
        pad(r.proposed.toFixed(1), 6) +
        pad(r.move > 0 ? `+${r.move.toFixed(1)}` : r.move.toFixed(1), 7) +
        flag
    );
  }

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply to write these levels.');
    return;
  }

  const { written, failed } = await applyLevels(db, rows);
  for (const f of failed) console.error('Failed for', f.name, f.message);
  console.log(`\nWrote ${written} levels.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
