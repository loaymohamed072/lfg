/* ==========================================================================
   LFG King of the Court — TV board driver.
   Polls /api/padel-board, repaints, runs the round clock. No interaction of
   any kind: this file never listens for a click, a hover, or a scroll.

   Two things it is careful about, because the board runs unattended for two
   hours on someone's laptop:
   1. It never repaints unless the data actually changed (`version`), so the
      screen is genuinely still between scores — a board that redraws every
      3 seconds shimmers, and shimmer at 8 metres reads as broken.
   2. A failed poll changes nothing on screen. Venue wifi drops; the last good
      board staying up is always better than an error message on a TV.
   ========================================================================== */
(function () {
  var POLL_MS = 4000;
  var COURTS = 4;

  var elTable = document.getElementById('pbTable');
  var elCourts = document.getElementById('pbCourts');
  var elClock = document.getElementById('pbClock');
  var elClockWrap = elClock ? elClock.parentNode : null;
  var elClockLabel = document.getElementById('pbClockLabel');
  var elRound = document.getElementById('pbRound');
  var elTeams = document.getElementById('pbTeams');
  var elPlayers = document.getElementById('pbPlayers');
  var elWhere = document.getElementById('pbWhere');

  var state = null;
  var lastVersion = null;
  var scoredKeys = Object.create(null);   // court keys that already had a score
  var firstPaint = true;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Partners rotate every round, so `state.teams` is only THIS round's pairings
  // and a name is always the two players currently standing on that side.
  function teamName(no) {
    if (!state) return 'Pair ' + no;
    for (var i = 0; i < state.teams.length; i++) {
      if (state.teams[i].team_no === no) return state.teams[i].name;
    }
    return 'Pair ' + no;
  }

  // ---- Leaderboard -------------------------------------------------------
  function paintTable() {
    if (!elTable) return;
    var rows = (state && state.standings) || [];
    if (!rows.length) {
      elTable.innerHTML = '<p class="pb-empty">Players go up when the night starts.</p>';
      return;
    }
    // Individual board: partners change every round, so the only thing worth
    // ranking is the player.
    var html = '<div class="pb-thead"><span>#</span><span>Player</span><span>Pts</span><span>W</span></div>';
    html += rows.map(function (r, i) {
      return '<div class="pb-row' + (i === 0 ? ' is-top' : '') + '">'
        + '<span class="pb-rank">' + (i + 1) + '</span>'
        + '<span class="pb-team">' + esc(r.name) + '</span>'
        + '<span class="pb-pts">' + r.points + '</span>'
        + '<span class="pb-wins">' + r.wins + '</span>'
        + '</div>';
    }).join('');
    elTable.innerHTML = html;
  }

  // ---- Courts ------------------------------------------------------------
  function paintCourts() {
    if (!elCourts) return;
    var round = state ? state.round : 1;
    var all = (state && state.matches) || [];
    var here = all.filter(function (m) { return m.round === round; });
    if (!here.length) {
      elCourts.innerHTML = '<p class="pb-empty">Courts appear when the first round is drawn.</p>';
      return;
    }

    var fresh = [];
    var html = '';
    for (var c = 1; c <= COURTS; c++) {
      var m = null;
      for (var i = 0; i < here.length; i++) if (here[i].court === c) m = here[i];
      if (!m) continue;

      var played = m.score_a != null && m.score_b != null;
      var key = round + ':' + c;
      // A score that was not there on the previous paint is the ONE motion
      // event this board has. Never fires on first paint, or every reload of
      // a finished round would flash the whole screen.
      if (played && !scoredKeys[key]) {
        scoredKeys[key] = true;
        if (!firstPaint) fresh.push(key);
      }

      var aWin = played && m.score_a > m.score_b;
      var bWin = played && m.score_b > m.score_a;
      var cls = 'pb-court-card'
        + (c === 1 ? ' is-throne' : '')
        + (played ? ' is-done' : ' is-pending');

      html += '<div class="' + cls + '" data-key="' + key + '">'
        + '<div class="pb-court-head">'
        + '<span class="pb-court-no">' + (c === 1 ? 'Court 1 &middot; The Throne' : 'Court ' + c) + '</span>'
        + '<span class="pb-court-state">' + (played ? 'Final' : 'Playing') + '</span>'
        + '</div>'
        + '<div class="pb-side' + (aWin ? ' is-winner' : '') + '">'
        + '<span class="pb-side-name">' + esc(teamName(m.team_a)) + '</span>'
        + '<span class="pb-side-score">' + (played ? m.score_a : '&ndash;') + '</span>'
        + '</div>'
        + '<span class="pb-vs">vs</span>'
        + '<div class="pb-side' + (bWin ? ' is-winner' : '') + '">'
        + '<span class="pb-side-name">' + esc(teamName(m.team_b)) + '</span>'
        + '<span class="pb-side-score">' + (played ? m.score_b : '&ndash;') + '</span>'
        + '</div>'
        + '</div>';
    }
    elCourts.innerHTML = html;

    fresh.forEach(function (key) {
      var card = elCourts.querySelector('[data-key="' + key + '"]');
      if (!card) return;
      // Next frame, so the class change is a transition and not the initial state.
      requestAnimationFrame(function () {
        card.classList.add('is-fresh');
        setTimeout(function () { card.classList.remove('is-fresh'); }, 2600);
      });
    });
  }

  function paintMeta() {
    if (!state) return;
    // Two pairings share a court, so the court count is half the pairing count.
    var courts = Math.ceil(state.teams.length / 2);
    var players = state.teams.reduce(function (n, t) { return n + t.players.length; }, 0);
    if (elTeams) elTeams.textContent = courts || '—';
    if (elPlayers) elPlayers.textContent = players || '—';
    if (elRound) elRound.textContent = state.round || '—';
    if (elWhere) elWhere.textContent = state.location || '—';
  }

  // ---- Clock -------------------------------------------------------------
  // Counts the play window down, then the rotation break, off the server's
  // round_started_at — so a laptop with a wrong clock still agrees with the
  // phone doing the scoring.
  function tick() {
    if (!elClock || !state || !state.round_started_at) {
      if (elClock) elClock.textContent = '--:--';
      return;
    }
    var started = new Date(state.round_started_at).getTime();
    if (!isFinite(started)) { elClock.textContent = '--:--'; return; }

    var playMs = (state.round_minutes || 15) * 60000;
    var breakMs = (state.break_minutes || 2) * 60000;
    var since = Date.now() - started;

    var left, label, urgent = false, isBreak = false;
    if (since < playMs) {
      left = playMs - since;
      label = 'Round ends in';
      urgent = left <= 60000;
    } else if (since < playMs + breakMs) {
      left = playMs + breakMs - since;
      label = 'Rotate now';
      isBreak = true;
      urgent = true;
    } else {
      left = 0;
      label = 'Next round';
    }

    var total = Math.max(0, Math.round(left / 1000));
    var mm = Math.floor(total / 60);
    var ss = total % 60;
    elClock.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    if (elClockLabel) elClockLabel.textContent = label;
    if (elClockWrap) {
      elClockWrap.classList.toggle('is-urgent', urgent);
      elClockWrap.classList.toggle('is-break', isBreak);
    }
  }

  // ---- Poll --------------------------------------------------------------
  // ?date=YYYY-MM-DD replays a past night on the TV (and is how the board gets
  // QA'd without touching the live night). Defaults to tonight.
  var qsDate = (function () {
    var m = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(window.location.search);
    return m ? m[1] : null;
  })();
  var BOARD_URL = '/api/padel-board' + (qsDate ? '?date=' + qsDate : '');

  function load() {
    fetch(BOARD_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;                       // keep the last good board up
        state = d;
        paintMeta();
        if (d.version !== lastVersion) {      // repaint only on real change
          lastVersion = d.version;
          paintTable();
          paintCourts();
          firstPaint = false;
        }
      })
      .catch(function () { /* venue wifi — the board holds what it has */ });
  }

  load();
  setInterval(load, POLL_MS);
  tick();
  setInterval(tick, 1000);
})();
