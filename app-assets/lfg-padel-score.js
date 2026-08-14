/* ==========================================================================
   LFG King of the Court — scoring page driver (/padel-score).
   Admin-gated. Reads the same /api/padel-board the TV reads, writes through
   /api/admin/padel-night, which is where every rule lives (server-side).

   Design constraint that drives everything here: Ahmed is standing on a court
   at 11pm with one hand free and 2 minutes between rounds. So: no confirm
   dialogs on the hot path, every save is independent (one court failing never
   blocks the other three), and the page never silently loses a typed score.
   ========================================================================== */
(function () {
  var SB_URL = 'https://mqhrjliqjxcxtzorapiy.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xaHJqbGlxanhjeHR6b3JhcGl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc3NzAsImV4cCI6MjA5NTM2Mzc3MH0.bj4EqOUQDGo-f-Qpmz4l1_ADXxhnSEaTuaQ6jsJe-Kw';

  var sb = window.supabase.createClient(SB_URL, ANON, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  var el = function (id) { return document.getElementById(id); };
  var gate = el('psGate');
  var app = el('psApp');
  var msgEl = el('psMsg');
  var matchesEl = el('psMatches');
  var roundEl = el('psRound');

  var board = null;
  var busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function say(text, isError) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.hidden = !text;
    msgEl.classList.toggle('is-error', !!isError);
  }

  async function token() {
    var r = await sb.auth.getSession();
    return r.data.session ? r.data.session.access_token : null;
  }

  // ?date=YYYY-MM-DD runs a REHEARSAL on a night that is not tonight, the same
  // escape hatch the TV board already has. Every read and every write carries
  // the date, so a practice night can never land on the real one by accident.
  var qsDate = (function () {
    var m = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(window.location.search);
    return m ? m[1] : null;
  })();
  var BOARD_URL = '/api/padel-board' + (qsDate ? '?date=' + qsDate : '');

  async function api(path, method, body) {
    var t = await token();
    if (!t) return { status: 401, ok: false, data: null };
    if (qsDate && body) body.event_date = qsDate;
    var res = await fetch(path, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: body ? JSON.stringify(body) : undefined
    });
    var d = null;
    try { d = await res.json(); } catch (e) {}
    return { status: res.status, ok: res.ok, data: d };
  }

  // Partners rotate every round, so `board.teams` holds only THIS round's
  // pairings and the name on a card is who is standing there right now.
  function teamName(no) {
    if (!board) return 'Pair ' + no;
    for (var i = 0; i < board.teams.length; i++) {
      if (board.teams[i].team_no === no) return board.teams[i].name;
    }
    return 'Pair ' + no;
  }

  // ---- Render ------------------------------------------------------------
  function render() {
    if (!board) return;
    if (roundEl) roundEl.textContent = board.round || '—';

    var round = board.round;
    var here = (board.matches || []).filter(function (m) { return m.round === round; });

    if (!here.length) {
      matchesEl.innerHTML = '<p class="ps-empty">No round drawn yet. Open “Set up the night” below to seed the courts and draw round one.</p>';
      return;
    }

    matchesEl.innerHTML = here.map(function (m) {
      var played = m.score_a != null && m.score_b != null;
      return '<div class="ps-match' + (m.court === 1 ? ' is-throne' : '') + (played ? ' is-saved' : '') + '" data-court="' + m.court + '">'
        + '<div class="ps-match-head">'
        + '<span class="ps-court">' + (m.court === 1 ? 'Court 1 &middot; The Throne' : 'Court ' + m.court) + '</span>'
        + '<span class="ps-state">' + (played ? 'Saved' : 'Not scored') + '</span>'
        + '</div>'
        + '<div class="ps-line">'
        + '<span class="ps-name">' + esc(teamName(m.team_a)) + '</span>'
        + '<input class="ps-input" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="50" '
        + 'aria-label="' + esc(teamName(m.team_a)) + ' score" data-side="a" value="' + (m.score_a == null ? '' : m.score_a) + '">'
        + '</div>'
        + '<div class="ps-line">'
        + '<span class="ps-name">' + esc(teamName(m.team_b)) + '</span>'
        + '<input class="ps-input" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="50" '
        + 'aria-label="' + esc(teamName(m.team_b)) + ' score" data-side="b" value="' + (m.score_b == null ? '' : m.score_b) + '">'
        + '</div>'
        + '<button type="button" class="ps-btn ps-save">' + (played ? 'Update score' : 'Save score') + '</button>'
        + '</div>';
    }).join('');
  }

  // Only re-render when the server's view changed. Ahmed may be mid-typing in
  // another card when a poll lands; blowing away his input would be the single
  // most infuriating bug this page could have.
  function typing() {
    var a = document.activeElement;
    return a && a.classList && a.classList.contains('ps-input');
  }

  async function load(force) {
    var res = await fetch(BOARD_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    if (!res) return;
    var changed = !board || board.version !== res.version || board.round !== res.round;
    board = res;
    if (force || (changed && !typing())) render();
  }

  // ---- Actions -----------------------------------------------------------
  matchesEl.addEventListener('click', async function (e) {
    var btn = e.target.closest('.ps-save');
    if (!btn || busy) return;
    var card = btn.closest('.ps-match');
    var court = Number(card.getAttribute('data-court'));
    var inputs = card.querySelectorAll('.ps-input');
    var a = inputs[0].value.trim();
    var b = inputs[1].value.trim();

    if (a === '' || b === '') { say('Enter both scores for court ' + court + '.', true); return; }
    if (a === b) { say('Court ' + court + ' is a draw — King of the Court needs a winner.', true); return; }

    busy = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    say('');

    var r = await api('/api/admin/padel-night', 'POST', {
      action: 'score', round: board.round, court: court, score_a: a, score_b: b
    });
    busy = false;
    btn.disabled = false;

    if (!r.ok) {
      btn.textContent = 'Save score';
      say((r.data && r.data.error) || 'That did not save. Try again.', true);
      return;
    }
    btn.textContent = 'Update score';
    card.classList.add('is-saved');
    card.querySelector('.ps-state').textContent = 'Saved';
    say('Court ' + court + ' saved. It is on the board.');
    load(false);
  });

  el('psNext').addEventListener('click', async function () {
    if (busy) return;
    // The rotation is computed FROM the results, so an unscored court has no
    // winner to move. The server refuses outright and says which round is short;
    // there is deliberately no "draw anyway" escape, because there is no honest
    // answer to "who goes up" when nobody won.
    var here = (board.matches || []).filter(function (m) { return m.round === board.round; });
    var unscored = here.filter(function (m) { return m.score_a == null || m.score_b == null; });
    if (unscored.length) {
      say('Score all ' + here.length + ' courts first — ' + unscored.length + ' still open. Winners move up, so every court needs a result.', true);
      return;
    }

    busy = true;
    say('');
    var r = await api('/api/admin/padel-night', 'POST', { action: 'draw_round', round: board.round + 1 });
    busy = false;
    if (!r.ok) { say((r.data && r.data.error) || 'Could not draw the round.', true); return; }
    say('Round ' + r.data.round + ' drawn. Winners moved up, partners swapped.');
    await load(true);
  });

  el('psStart').addEventListener('click', async function () {
    if (busy) return;
    busy = true;
    var r = await api('/api/admin/padel-night', 'POST', { action: 'start_round', round: board.round });
    busy = false;
    say(r.ok ? 'Clock restarted for round ' + board.round + '.' : 'Could not restart the clock.', !r.ok);
    load(false);
  });

  el('psBuild').addEventListener('click', async function () {
    if (busy) return;
    if (!window.confirm('Seed the courts from everyone who paid? This clears any pairings and scores already set for tonight.')) return;
    busy = true;
    say('');
    // build_teams seeds the courts AND draws round 1 in one write, so there is
    // no window where the courts exist but no fixtures do.
    var r = await api('/api/admin/padel-night', 'POST', { action: 'build_teams' });
    busy = false;
    if (!r.ok) { say((r.data && r.data.error) || 'Could not seed the courts.', true); return; }
    var msg = r.data.courts + ' courts seeded and round 1 drawn. Go play.';
    if (r.data.benched) msg += ' ' + r.data.benched + ' player(s) sitting out — courts need four.';
    say(msg);
    await load(true);
  });

  el('psReset').addEventListener('click', async function () {
    if (busy) return;
    if (!window.confirm('Reset tonight? Every pairing, score and banked point is deleted. There is no undo.')) return;
    busy = true;
    var r = await api('/api/admin/padel-night', 'POST', { action: 'reset' });
    busy = false;
    say(r.ok ? 'Night reset. Seed the courts when you are ready.' : 'Could not reset.', !r.ok);
    await load(true);
  });

  // ---- Gate --------------------------------------------------------------
  (async function start() {
    var t = await token();
    if (!t) {
      gate.innerHTML = 'Sign in as an admin first, then come back: <a href="/admin.html">open the admin panel</a>.';
      return;
    }
    // The server is the real gate (requireAdmin on every write). This call just
    // decides what to show, so a non-admin sees an honest message instead of a
    // page full of buttons that all fail.
    var probe = await api('/api/admin/padel-night', 'POST', { action: 'ping' });
    if (probe.status === 401 || probe.status === 403) {
      gate.textContent = 'This page is for coaches running the night.';
      return;
    }
    gate.hidden = true;
    app.hidden = false;
    // Rehearsal mode is loud on purpose: scoring a practice night while
    // believing it is tonight would be the worst possible confusion.
    if (qsDate) {
      var flag = document.createElement('p');
      flag.className = 'ps-msg';
      flag.style.cssText = 'margin:0 0 16px;border-color:var(--pb-olive-text);';
      flag.textContent = 'PRACTICE NIGHT · ' + qsDate + '. Nothing here touches a real night. Drop the ?date= from the URL to score for real.';
      app.insertBefore(flag, app.firstChild);
    }
    await load(true);
    setInterval(function () { load(false); }, 6000);
  })();
})();
