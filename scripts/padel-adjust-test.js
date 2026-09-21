/**
 * Manual level adjustments survive the re-rating.
 *
 * On 21 Sep the first real "finish night" replayed every result from the quiz
 * seed and wrote the answer over the levels Ahmed had set by hand (Khalfan 3 -> 2).
 * A manual adjustment now lives in padel_profiles.level_adjust as an offset in
 * levels, and the re-rating writes results + offset.
 *
 *   node scripts/padel-adjust-test.js
 */
const { computeLevels } = require('../api/_padel-rating');

// Two players on one side beat two on the other, 6-2, one night.
const D = '2026-09-21';
function fakeDb(profiles) {
  const tables = {
    padel_teams: [
      { event_date: D, round: 1, team_no: 1, player_a: 'a1', player_b: 'a2' },
      { event_date: D, round: 1, team_no: 2, player_a: 'b1', player_b: 'b2' },
    ],
    padel_matches: [{ event_date: D, round: 1, court: 1, team_a: 1, team_b: 2, score_a: 6, score_b: 2 }],
    padel_profiles: profiles,
    members: ['a1', 'a2', 'b1', 'b2'].map((id) => ({ id, full_name: id })),
  };
  return { from: (t) => ({ select: async () => ({ data: tables[t] }) }) };
}
const prof = (id, level, initial, adjust) => ({
  member_id: id, level, initial_level: initial, estimated: false, level_adjust: adjust,
});

async function run() {
  const cases = [];
  const check = (name, ok) => cases.push([name, ok]);

  // No adjustments: behaves exactly as before.
  const plain = await computeLevels(fakeDb([
    prof('a1', 3, 3, 0), prof('a2', 3, 3, 0), prof('b1', 3, 3, 0), prof('b2', 3, 3, 0),
  ]));
  const p = Object.fromEntries(plain.rows.map((r) => [r.id, r]));
  check('no adjustment: winner level is the plain result', p.a1.proposed === 3 && p.a1.adjust === 0);

  // Ahmed raised a1 by a full level: it stays on top of the result.
  const up = await computeLevels(fakeDb([
    prof('a1', 4, 3, 1), prof('a2', 3, 3, 0), prof('b1', 3, 3, 0), prof('b2', 3, 3, 0),
  ]));
  const u = Object.fromEntries(up.rows.map((r) => [r.id, r]));
  check('raised a level by hand: kept on top of the result', u.a1.proposed === p.a1.proposed + 1);
  check('raised a level by hand: re-rating is a no-op when nothing changed', u.a1.move === 0);
  check('teammate without adjustment is unaffected', u.a2.proposed === p.a2.proposed);

  // Lowered half a level.
  const down = await computeLevels(fakeDb([
    prof('a1', 3, 3, 0), prof('a2', 3, 3, 0), prof('b1', 2.5, 3, -0.5), prof('b2', 3, 3, 0),
  ]));
  const d = Object.fromEntries(down.rows.map((r) => [r.id, r]));
  check('lowered half a level by hand: kept', d.b1.proposed === p.b1.proposed - 0.5);

  // Clamped to the 1..7 scale.
  const hi = await computeLevels(fakeDb([
    prof('a1', 7, 3, 9), prof('a2', 3, 3, 0), prof('b1', 3, 3, 0), prof('b2', 3, 3, 0),
  ]));
  check('an adjustment never pushes past level 7', hi.rows.find((r) => r.id === 'a1').proposed === 7);

  // A profile row from before the column existed (no level_adjust key) reads as 0.
  const legacy = await computeLevels(fakeDb([
    { member_id: 'a1', level: 3, initial_level: 3, estimated: false },
    prof('a2', 3, 3, 0), prof('b1', 3, 3, 0), prof('b2', 3, 3, 0),
  ]));
  check('missing level_adjust reads as no adjustment', legacy.rows.find((r) => r.id === 'a1').proposed === p.a1.proposed);

  let failed = 0;
  for (const [name, ok] of cases) {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}
run();
