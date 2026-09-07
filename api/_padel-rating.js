/**
 * Padel levels from match results.
 *
 * Why a rating and not a win record: the draw is level-balanced and King of the
 * Court rotates partners every round, so raw win% mostly measures who you were
 * drawn with. A player carried by a strong partner and a player dragging a weak
 * one can finish the night on the same 3-2. Elo prices the opponent in, so
 * beating a stronger court moves you more than beating a weaker one.
 *
 * Recomputed from every match ever played rather than incremented, the same
 * philosophy as the points banking in padel-night.js: a corrected score
 * corrects the levels instead of stacking on top of the mistake. That also
 * means running this twice is harmless.
 *
 * Used by the 'finish' action in admin/padel-night.js and by
 * scripts/padel-rerate.js, which prints the same table without writing.
 */

// Level 1..7 maps onto 1000..1600. One level = 100 rating points, so a full
// level of movement is a real night's worth of results, not a rounding error.
const PER_LEVEL = 100;
const BASE = 1000;
const DEFAULT_LEVEL = 3.0;

// Provisional players move fast because their seed is a self-assessment quiz
// and it is often wrong. After 10 rated matches the seed has been tested and
// the rating slows down so one bad night cannot undo a month.
const K_PROVISIONAL = 40;
const K_ESTABLISHED = 20;
const PROVISIONAL_MATCHES = 10;

// No player moves more than one level in a single night, however the night
// went. Protects against a freak scoreline and against a mis-typed score that
// nobody caught until the morning.
const MAX_NIGHT_SWING = PER_LEVEL;

// A 6-0 says more than a 6-5, but the win itself is most of the signal. Pure
// margin scoring would let one blowout outweigh three close wins.
const WIN_WEIGHT = 0.75;

const toRating = (level) => BASE + (Number(level) - 1) * PER_LEVEL;

function toLevel(rating) {
  const raw = (rating - BASE) / PER_LEVEL + 1;
  return Math.min(7, Math.max(1, Math.round(raw * 2) / 2));
}

function expected(ratingFor, ratingAgainst) {
  return 1 / (1 + Math.pow(10, (ratingAgainst - ratingFor) / 400));
}

/**
 * Replay every scored match and return one row per player who has played.
 * Reads only; the caller decides whether to write.
 */
async function computeLevels(db) {
  const [{ data: teams }, { data: matches }, { data: profiles }, { data: members }] =
    await Promise.all([
      db.from('padel_teams').select('event_date, round, team_no, player_a, player_b'),
      db.from('padel_matches').select('event_date, round, court, team_a, team_b, score_a, score_b'),
      db.from('padel_profiles').select('member_id, level, initial_level, estimated'),
      db.from('members').select('id, full_name'),
    ]);

  const nameOf = new Map((members || []).map((m) => [m.id, m.full_name || 'Unnamed']));
  const profileOf = new Map((profiles || []).map((p) => [p.member_id, p]));
  const teamAt = new Map(
    (teams || []).map((t) => [`${t.event_date}:${t.round}:${t.team_no}`, t])
  );

  // Seed every player from the quiz answer, not their current level: the quiz
  // is the estimate we are testing, and replaying from it is what makes a
  // rerun reproducible.
  const rating = new Map();
  const rated = new Map();
  const seedLevel = new Map();
  const seed = (id) => {
    if (!id || rating.has(id)) return;
    const p = profileOf.get(id);
    const level = Number(p?.initial_level ?? p?.level ?? DEFAULT_LEVEL) || DEFAULT_LEVEL;
    seedLevel.set(id, level);
    rating.set(id, toRating(level));
    rated.set(id, 0);
  };
  for (const t of teams || []) { seed(t.player_a); seed(t.player_b); }

  const played = (matches || [])
    .filter((m) => m.score_a != null && m.score_b != null && m.score_a !== m.score_b)
    .sort((x, y) =>
      x.event_date.localeCompare(y.event_date) || x.round - y.round || x.court - y.court
    );

  const nights = [...new Set(played.map((m) => m.event_date))].sort();

  for (const night of nights) {
    const startOfNight = new Map(rating);

    for (const m of played.filter((p) => p.event_date === night)) {
      const ta = teamAt.get(`${night}:${m.round}:${m.team_a}`);
      const tb = teamAt.get(`${night}:${m.round}:${m.team_b}`);
      if (!ta || !tb) continue;
      const sideA = [ta.player_a, ta.player_b].filter(Boolean);
      const sideB = [tb.player_a, tb.player_b].filter(Boolean);
      if (!sideA.length || !sideB.length) continue;

      const avg = (ids) => ids.reduce((n, id) => n + rating.get(id), 0) / ids.length;
      const ra = avg(sideA);
      const rb = avg(sideB);
      const aWon = m.score_a > m.score_b;
      const total = m.score_a + m.score_b;

      // Margin-aware result, blended toward the plain win/loss.
      const marginA = total > 0 ? m.score_a / total : 0.5;
      const actualA = WIN_WEIGHT * (aWon ? 1 : 0) + (1 - WIN_WEIGHT) * marginA;
      const eA = expected(ra, rb);

      for (const [side, actual, e] of [
        [sideA, actualA, eA],
        [sideB, 1 - actualA, 1 - eA],
      ]) {
        for (const id of side) {
          const k = rated.get(id) < PROVISIONAL_MATCHES ? K_PROVISIONAL : K_ESTABLISHED;
          rating.set(id, rating.get(id) + k * (actual - e));
          rated.set(id, rated.get(id) + 1);
        }
      }
    }

    // Clamp the night's total movement per player.
    for (const [id, before] of startOfNight) {
      const delta = rating.get(id) - before;
      if (Math.abs(delta) > MAX_NIGHT_SWING) {
        rating.set(id, before + Math.sign(delta) * MAX_NIGHT_SWING);
      }
    }
  }

  return {
    nights,
    rows: [...rating.keys()]
      .filter((id) => rated.get(id) > 0)
      .map((id) => {
        const p = profileOf.get(id);
        const current = Number(p?.level ?? seedLevel.get(id));
        const proposed = toLevel(rating.get(id));
        return {
          id,
          name: nameOf.get(id) || 'Unknown',
          matches: rated.get(id),
          seed: seedLevel.get(id),
          current,
          proposed,
          move: Number((proposed - current).toFixed(1)),
          rating: Math.round(rating.get(id)),
          overridden: p ? Number(p.level) !== Number(p.initial_level) : false,
          missingProfile: !p,
        };
      })
      .sort((a, b) => b.move - a.move || b.matches - a.matches),
  };
}

/** Write the levels that actually changed. Returns how many rows moved. */
async function applyLevels(db, rows) {
  let written = 0;
  const failed = [];
  for (const r of rows) {
    if (r.move === 0 || r.missingProfile) continue;
    const { error } = await db
      .from('padel_profiles')
      .update({ level: r.proposed, estimated: false, updated_at: new Date().toISOString() })
      .eq('member_id', r.id);
    if (error) failed.push({ name: r.name, message: error.message });
    else written++;
  }
  return { written, failed };
}

module.exports = { computeLevels, applyLevels, toLevel, PER_LEVEL, MAX_NIGHT_SWING };
