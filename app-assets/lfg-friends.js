/* Train with a friend (2026-11-02). "Training with a friend is always better."
   Three ways in, all at the normal ticket price:
     1. Booking modal: "+ Add a friend" rows (name + email). Everyone pays by card together
        and lands on one station; the station-balancing window does not apply to a group.
     2. After booking (success screen and each booking on /account): hold 1-7 spots on your
        station, share the invite link (copy, WhatsApp) or send it to a member's email.
     3. /bootcamp?join=TOKEN: the friend's landing. Sign in keeps the token; book with a card
        or with your own credit.
   Loaded by lfg-home-booking.js (homepage + /bootcamp) and by account.html. Talks to
   /api/friends, /api/checkout and /api/book through window.lfg. The pure helpers at the top
   are unit-tested in scripts/friends.test.js. */
(function () {
  'use strict';

  var MAX = 7;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function cleanName(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, 80); }
  function validEmail(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
  }

  // Friend rows typed in the booking modal -> { n, friends, error }. A blank row costs nothing.
  function checkRows(rows, ownEmail) {
    var me = String(ownEmail || '').trim().toLowerCase(), seen = {}, out = [], error = '';
    (rows || []).forEach(function (r) {
      var rawName = String((r && r.name) || '').trim(), rawEmail = String((r && r.email) || '').trim();
      if (!rawName && !rawEmail) return;
      var name = cleanName(rawName), email = validEmail(rawEmail);
      if (!error) {
        if (!name) error = 'Add a name for each friend.';
        else if (!email) error = 'Check the email for ' + name + '.';
        else if (me && email === me) error = "That's your own email. Add your friend's.";
        else if (seen[email]) error = email + ' is on the list twice.';
      }
      if (email) seen[email] = true;
      out.push({ name: name, email: email || rawEmail });
    });
    if (!error && out.length > MAX) error = 'You can bring up to 7 friends.';
    return { n: out.length, friends: out, error: error };
  }

  // Can the picked station take the whole group? '' when it can.
  function fitMessage(section, room, people) {
    if (!section || people <= 1 || room >= people) return '';
    if (room <= 0) return 'Station ' + section + ' is full. Pick another station.';
    return 'Station ' + section + ' has room for ' + room + ' of you. Pick another station or remove a friend.';
  }

  function groupTotal(buyer, friend, n) { return Math.round((Number(buyer) + Number(friend) * n) * 100) / 100; }

  function timeLeft(expiresIso, nowMs) {
    var ms = Date.parse(expiresIso) - nowMs;
    if (!(ms > 0)) return 'Ended';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    if (h >= 1) return h + 'h ' + (m % 60) + 'm left';
    return m < 1 ? 'Under a minute left' : m + 'm left';
  }

  // "Sun 9 Nov · 12:45 PM" from a session's date and start time (Dubai).
  function whenText(s) {
    if (!s || !s.session_date) return '';
    var day = new Date(s.session_date + 'T12:00:00+04:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
    var p = String(s.start_time || '12:30').split(':'), h = parseInt(p[0], 10), m = p[1] || '00';
    if (isNaN(h)) return day;
    return day + ' · ' + ((h % 12) || 12) + ':' + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function shareText(o) {
    return 'Training with a friend is always better. I saved you a spot on Station ' + o.station +
      ' at LFG Sunday Bootcamp, ' + o.when + '. ' + (o.free ? 'It’s free this Sunday' : 'Same price as a normal ticket: AED ' + o.price) + '. Grab it here: ' + o.link;
  }

  // Title and line for the /bootcamp?join= landing, by hold status.
  function landingCopy(d) {
    var host = d.host_first_name || 'your friend', Host = d.host_first_name || 'Your friend', st = d.station;
    switch (d.status) {
      case 'active': return { title: 'Join ' + host + ' on Station ' + st, text: '' };
      case 'expired': return { title: 'This saved spot has ended', text: Host + '’s spots on Station ' + st + ' were held for 24 hours and are open to everyone now.' };
      case 'cancelled': return { title: 'This saved spot has ended', text: Host + ' released the spots on Station ' + st + '.' };
      case 'full': return { title: 'Those spots are taken', text: 'Every spot ' + host + ' saved on Station ' + st + ' has been claimed.' };
      case 'closed': return { title: 'Booking has closed', text: 'This Sunday is no longer taking bookings.' };
      default: return { title: 'This invite link does not work', text: 'Ask your friend to send it again.' };
    }
  }

  var pure = { checkRows: checkRows, fitMessage: fitMessage, groupTotal: groupTotal, timeLeft: timeLeft,
    whenText: whenText, shareText: shareText, landingCopy: landingCopy, validEmail: validEmail };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }
  if (typeof window === 'undefined' || !window.document) return;

  // ------------------------------------------------------------------ browser

  var JOIN_KEY = 'lfg_join_after_login';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, opts) { return window.lfg.api(path, opts); }
  function post(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
  function copy(text, input) {
    function fallback() { try { input.select(); return document.execCommand('copy'); } catch (e) { return false; } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  // ------------------------------------------------ 1. friends in the booking modal

  var picker = null;   // the open booking modal
  var store = {};      // session id -> rows, so Back from checkout keeps what was typed

  function mount(modalEl, session, hooks) {
    var slot = modalEl.querySelector('#lfgwFriends');
    if (!slot || !session) { picker = null; return; }
    // A free Sunday has nothing to pay for friends: they join free from the host's link.
    if (session.is_free) {
      picker = null;
      slot.innerHTML = '<div class="lfgw-text">Bringing friends? Book your spot, then hold spots for them on your station. They join free.</div>';
      return;
    }
    modalEl.classList.add('co'); // the widget's scrollable-modal class: rows make it taller
    picker = { s: session, h: hooks || {}, el: slot, rows: store[session.id] || (store[session.id] = []), own: '', group: false, tiles: [] };
    modalEl.querySelectorAll('.lfgw-sec').forEach(function (t) {
      picker.tiles.push({ el: t, cls: t.className, html: t.innerHTML });
      t.addEventListener('click', function () { refresh(); }); // after the widget's own handler
    });
    var mine = picker;
    if (window.lfg && window.lfg.getSession) {
      window.lfg.getSession().then(function (s) { if (picker === mine && s && s.user) { mine.own = s.user.email || ''; update(); } });
    }
    slot.className = 'lfgw-promo lfgf';
    slot.innerHTML =
      '<div class="lfgw-text">Training with a friend is always better.</div>' +
      '<div class="lfgf-rows"></div>' +
      '<button type="button" class="lfgw-promo-toggle lfgf-add">+ Add a friend</button>' +
      '<div class="lfgw-promo-msg lfgf-sum" role="status" aria-live="polite"></div>';
    slot.querySelector('.lfgf-add').addEventListener('click', function () {
      if (mine.rows.length >= MAX) return;
      mine.rows.push({ name: '', email: '' });
      drawRows(true); update();
    });
    drawRows(false);
    update();
  }

  function drawRows(focusLast) {
    var p = picker, wrap = p.el.querySelector('.lfgf-rows');
    wrap.innerHTML = p.rows.map(function (r, i) {
      return '<div class="lfgw-promo-field lfgw-opt lfgf-row" data-i="' + i + '">' +
        '<input class="lfgf-in" data-k="name" type="text" maxlength="80" autocomplete="off" placeholder="Friend’s name" aria-label="Friend ' + (i + 1) + ' name" value="' + esc(r.name) + '">' +
        '<input class="lfgf-in" data-k="email" type="email" inputmode="email" maxlength="254" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Their email" aria-label="Friend ' + (i + 1) + ' email" value="' + esc(r.email) + '">' +
        '<button type="button" class="lfgw-promo-x lfgf-x" aria-label="Remove friend ' + (i + 1) + '">&times;</button></div>';
    }).join('');
    wrap.querySelectorAll('.lfgf-row').forEach(function (row) {
      var i = Number(row.getAttribute('data-i'));
      row.querySelectorAll('.lfgf-in').forEach(function (inp) {
        inp.addEventListener('input', function () { p.rows[i][inp.getAttribute('data-k')] = inp.value; update(); });
      });
      row.querySelector('.lfgf-x').addEventListener('click', function () { p.rows.splice(i, 1); drawRows(false); update(); });
    });
    p.el.querySelector('.lfgf-add').hidden = p.rows.length >= MAX;
    if (focusLast) { var last = wrap.querySelector('.lfgf-row:last-child .lfgf-in'); if (last) last.focus(); }
  }

  function sectionOf(label) { return ((picker && picker.s.sections) || []).filter(function (x) { return x.label === label; })[0]; }

  // What the widget's pay button needs: how many friends, their rows, and whether it can go.
  function state(sessionId) {
    var p = picker;
    if (!p || (sessionId && p.s.id !== sessionId)) return { n: 0, ok: true, friends: [] };
    var chk = checkRows(p.rows, p.own);
    if (!chk.n) return { n: 0, ok: true, friends: [] };
    var picked = p.h.picked && p.h.picked();
    var sec = picked && sectionOf(picked);
    var fit = chk.error ? '' : fitMessage(picked, sec ? sec.spots_left : 0, chk.n + 1);
    return { n: chk.n, friends: chk.friends, ok: !chk.error && !fit, error: chk.error || fit };
  }

  // A group skips the balancing window: a station that is only "waiting" opens up, and each
  // tile shows its real room. Back to solo, the widget's own tiles come back.
  function applyTileMode(group) {
    var p = picker;
    if (!p || p.group === group) return;
    p.group = group;
    p.tiles.forEach(function (t) {
      var label = t.el.getAttribute('data-sec'), sec = sectionOf(label) || {}, sel = t.el.classList.contains('sel');
      if (group) {
        var left = sec.spots_left || 0;
        t.el.className = 'lfgw-sec' + (left <= 0 ? ' full' : '') + (sel && left > 0 ? ' sel' : '');
        t.el.innerHTML = '<div class="l">' + esc(label) + '</div><div class="n' + (left > 0 && left <= 2 ? ' hot' : '') + '">' +
          (left <= 0 ? 'Full' : left <= 2 ? 'Only ' + left + ' left' : left + ' left') + '</div>';
      } else {
        t.el.className = t.cls + (sel && t.cls.indexOf('full') < 0 ? ' sel' : '');
        t.el.innerHTML = t.html;
      }
    });
    var picked = p.h.picked && p.h.picked();
    if (!group && picked) {
      var tile = p.tiles.filter(function (t) { return t.el.getAttribute('data-sec') === picked; })[0];
      if (tile && tile.cls.indexOf('full') >= 0 && p.h.unpick) p.h.unpick();
    }
  }

  function refresh() {
    var p = picker; if (!p) return;
    var st = state(p.s.id);
    applyTileMode(st.n > 0);
    var sum = p.el.querySelector('.lfgf-sum');
    if (!st.n) { sum.className = 'lfgw-promo-msg lfgf-sum'; sum.innerHTML = ''; return; }
    if (st.error) { sum.className = 'lfgw-promo-msg err lfgf-sum'; sum.textContent = st.error; return; }
    var price = p.h.price ? p.h.price() : { buyer: 0, friend: 0 };
    var picked = p.h.picked && p.h.picked(), people = st.n + 1;
    sum.className = 'lfgw-promo-msg lfgf-sum';
    sum.innerHTML = '<b>' + people + ' of you' + (picked ? ' on Station ' + esc(picked) : '') + '</b> · AED ' + groupTotal(price.buyer, price.friend, st.n) +
      (picked ? '' : '<br>Pick a station with room for all ' + people + '.') +
      (p.h.credits && p.h.credits() > 0 ? '<br>Everyone pays by card, so your credits stay for another Sunday.' : '');
  }
  function update() { refresh(); if (picker && picker.h.changed) picker.h.changed(); }

  function reset(sessionId) {
    delete store[sessionId];
    if (picker && picker.s.id === sessionId) picker.rows = store[sessionId] = [];
  }

  // ------------------------------------------------ 2. "Bring friends" after booking

  function afterBooking(sessionId, opts) {
    var w = window.lfgWidget;
    if (!w || !w.modal) return;
    var meta = w.modal.querySelector('.lfgw-success-meta');
    if (!meta) return;
    var box = document.createElement('div');
    box.className = 'lfgf-after';
    meta.parentNode.insertBefore(box, meta.nextSibling);
    w.modal.classList.add('co');
    panel(box, sessionId, { wait: !!(opts && opts.wait) });
  }

  function panel(box, sessionId, opts) {
    var tries = 0, spots = 1, ticker = null;
    box.innerHTML = '<div class="lfgw-upsell lfgf-panel"><div class="lfgw-promo-msg">Loading your friend spots…</div></div>';

    function stop() { if (ticker) { clearInterval(ticker); ticker = null; } }
    async function load() {
      var r = await api('/api/friends?session_id=' + encodeURIComponent(sessionId));
      if (!box.isConnected) return stop();
      if (!r.ok || !r.data || !r.data.ok) {
        box.innerHTML = '<div class="lfgw-upsell lfgf-panel"><div class="lfgw-promo-msg err">Could not load your friend spots. Try again in a minute.</div></div>';
        return;
      }
      var d = r.data;
      if (!d.booked) {
        // A card booking lands a second or two after payment, through the webhook.
        if (opts.wait && tries++ < 5) { setTimeout(load, 1500); return; }
        box.innerHTML = opts.wait
          ? '<div class="lfgw-upsell lfgf-panel"><div class="lfgw-promo-msg">Your spot is confirming. Bring friends from <a href="/account" class="lfgw-terms-link">My bookings</a> in a minute.</div></div>'
          : '';
        return;
      }
      draw(d);
    }

    function holdHtml(d, h) {
      var head = '<b>' + h.spots + (h.spots === 1 ? ' spot' : ' spots') + '</b> · ' +
        (h.left > 0 ? h.claimed + ' taken · <span class="lfgf-left" data-exp="' + esc(h.expires_at) + '">' + timeLeft(h.expires_at, Date.now()) + '</span>' : 'all taken');
      var cancel = '<button type="button" class="lfgw-streak-go lfgf-cancel">Cancel hold</button>';
      if (h.left <= 0) return '<div class="lfgw-streak lfgf-hold" data-id="' + esc(h.id) + '">' + head + '<br>' + cancel + '</div>';
      return '<div class="lfgw-streak lfgf-hold" data-id="' + esc(h.id) + '" data-link="' + esc(h.link) + '">' + head +
        '<div class="lfgw-promo">' +
          '<div class="lfgw-opt lfgf-link">' +
          '<button type="button" class="lfgw-pack-buy lfgf-copy">Copy link</button>' +
          '<button type="button" class="lfgw-pack-buy lfgf-wa">WhatsApp</button></div>' +
          '<form class="lfgw-promo-field lfgf-mail" novalidate><input type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Friend’s email" aria-label="Send to a friend’s email">' +
          '<button type="submit" class="lfgw-promo-apply">Send</button></form>' +
          '<div class="lfgw-promo-msg lfgf-msg" role="status" aria-live="polite"></div>' +
        '</div>' + cancel + '</div>';
    }

    function draw(d) {
      var room = d.room || 0;
      spots = Math.max(1, Math.min(spots, room || 1));
      var make;
      if (!d.open) make = '<div class="lfgw-promo-msg">Booking has closed for this Sunday.</div>';
      else if (room > 0) {
        make = '<div class="lfgw-seclabel">Spots to hold</div><div class="lfgw-promo-field lfgw-opt lfgf-make">' +
          '<button type="button" class="lfgw-promo-apply" data-d="-1" aria-label="Fewer spots">&minus;</button>' +
          '<input type="text" class="lfgf-count" readonly value="' + spots + '" aria-label="Spots to hold" aria-live="polite">' +
          '<button type="button" class="lfgw-promo-apply" data-d="1" aria-label="More spots">+</button>' +
          '<button type="button" class="lfgw-pack-buy lfgf-go">Create invite link</button></div>';
      } else {
        make = '<div class="lfgw-promo-msg">' + (d.held >= 7 ? 'You’re holding the most spots you can for this Sunday.'
          : 'Station ' + esc(d.section) + ' is full, so there’s no room to hold spots.') + '</div>';
      }
      box.innerHTML = '<div class="lfgw-upsell lfgf-panel">' +
        '<div class="lfgw-upsell-h">Bring friends: hold spots on Station ' + esc(d.section) + '</div>' +
        '<div class="lfgw-text">Training with a friend is always better. The spots stay locked for your friends for 24 hours, then open to everyone. ' + (d.free ? 'This Sunday is free, for them too.' : 'Same price as a normal ticket: <b>AED ' + esc(d.price_aed) + '</b>.') + '</div>' +
        make + '<div class="lfgw-promo-msg lfgf-msg lfgf-main-msg" role="status" aria-live="polite"></div>' +
        (d.holds.length ? '<div class="lfgf-holds">' + d.holds.map(function (h) { return holdHtml(d, h); }).join('') + '</div>' : '') +
        '</div>';
      wire(d);
    }

    function wire(d) {
      var main = box.querySelector('.lfgf-main-msg');
      function say(el, text, err) { el.textContent = text || ''; el.className = 'lfgw-promo-msg lfgf-msg' + (el === main ? ' lfgf-main-msg' : '') + (err ? ' err' : ''); }
      box.querySelectorAll('.lfgf-make [data-d]').forEach(function (b) {
        b.addEventListener('click', function () {
          spots = Math.max(1, Math.min(d.room, spots + Number(b.getAttribute('data-d'))));
          box.querySelector('.lfgf-count').value = String(spots);
        });
      });
      var go = box.querySelector('.lfgf-go');
      if (go) go.addEventListener('click', async function () {
        go.disabled = true; go.textContent = 'Creating…';
        var r = await post('/api/friends', { action: 'hold', session_id: sessionId, spots: spots });
        if (r.ok && r.data && r.data.ok) { spots = 1; await load(); var m = box.querySelector('.lfgf-main-msg'); if (m) say(m, 'Link ready. Copy it or send it on WhatsApp.'); return; }
        go.disabled = false; go.textContent = 'Create invite link';
        say(main, (r.data && r.data.error) || 'Could not hold the spots.', true);
        if (r.data && r.data.room != null) setTimeout(load, 1200);
      });
      box.querySelectorAll('.lfgf-hold').forEach(function (el) {
        var id = el.getAttribute('data-id'), msg = el.querySelector('.lfgf-msg') || main;
        var cancel = el.querySelector('.lfgf-cancel'), armed = null;
        cancel.addEventListener('click', async function () {
          if (!armed) {
            cancel.textContent = 'Tap again to release';
            armed = setTimeout(function () { armed = null; cancel.textContent = 'Cancel hold'; }, 4000);
            return;
          }
          clearTimeout(armed); cancel.disabled = true;
          var r = await post('/api/friends', { action: 'cancel', hold_id: id });
          if (r.ok && r.data && r.data.ok) return load();
          cancel.disabled = false; say(msg, (r.data && r.data.error) || 'Could not cancel.', true);
        });
        var cp = el.querySelector('.lfgf-copy');
        if (cp) cp.addEventListener('click', function () {
          var link = el.getAttribute('data-link'), tmp = document.createElement('input');
          tmp.value = link; tmp.readOnly = true; tmp.setAttribute('aria-hidden', 'true');
          tmp.style.position = 'fixed'; tmp.style.opacity = '0';
          el.appendChild(tmp);
          copy(link, tmp).then(function (ok) {
            tmp.remove();
            if (ok) { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy link'; }, 2000); }
            else say(msg, 'Copy this link: ' + link);
          });
        });
        var wa = el.querySelector('.lfgf-wa');
        if (wa) wa.addEventListener('click', function () {
          var url = 'https://wa.me/?text=' + encodeURIComponent(shareText({ station: d.section, when: whenText(d.session), price: d.price_aed, free: d.free, link: el.getAttribute('data-link') }));
          // window.open with 'noopener' always returns null, so clear opener by hand instead.
          var win = window.open(url, '_blank');
          if (win) win.opener = null; else window.location.href = url;
        });
        var form = el.querySelector('.lfgf-mail');
        if (form) form.addEventListener('submit', async function (e) {
          e.preventDefault();
          var inp = form.querySelector('input'), btn = form.querySelector('button');
          var email = validEmail(inp.value);
          if (!email) return say(msg, 'Enter your friend’s email.', true);
          btn.disabled = true; btn.textContent = 'Sending…';
          var r = await post('/api/friends', { action: 'invite', hold_id: id, email: email });
          btn.disabled = false; btn.textContent = 'Send';
          if (r.ok && r.data && r.data.ok) { say(msg, r.data.message); if (r.data.sent) inp.value = ''; }
          else say(msg, (r.data && r.data.error) || 'Could not send it. Share your link instead.', true);
        });
      });
      stop();
      if (box.querySelector('.lfgf-left')) {
        ticker = setInterval(function () {
          if (!box.isConnected) return stop();
          var ended = false;
          box.querySelectorAll('.lfgf-left').forEach(function (s) {
            var t = timeLeft(s.getAttribute('data-exp'), Date.now());
            s.textContent = t; if (t === 'Ended') ended = true;
          });
          if (ended) { stop(); load(); }
        }, 30000);
      }
    }

    load();
  }

  // My bookings on /account: a "Bring friends" button beside each booking's controls; the
  // panel opens under that booking.
  function mountAccount(wrap) {
    if (!wrap) return;
    wrap.querySelectorAll('.lfgf-slot[data-sid]').forEach(function (slot) {
      if (slot.getAttribute('data-ready')) return;
      slot.setAttribute('data-ready', '1');
      var sid = slot.getAttribute('data-sid'), row = slot.closest('.lfg-row') || slot, body = null;
      slot.innerHTML = '<button type="button" class="lfgw-pack-buy lfgf-toggle" aria-expanded="false">Bring friends</button>';
      var btn = slot.querySelector('.lfgf-toggle');
      btn.addEventListener('click', function () {
        if (!body) {
          body = document.createElement('div');
          body.className = 'lfgf-body';
          row.parentNode.insertBefore(body, row.nextSibling);
          panel(body, sid, { wait: false });
        } else body.hidden = !body.hidden;
        btn.setAttribute('aria-expanded', String(!body.hidden));
        btn.textContent = body.hidden ? 'Bring friends' : 'Hide';
      });
    });
  }

  // ------------------------------------------------ 3. the /bootcamp?join= landing

  function joinToken() {
    try { var t = new URLSearchParams(window.location.search).get('join'); return /^[a-f0-9]{64}$/.test(t || '') ? t : null; }
    catch (e) { return null; }
  }
  function clearJoin() {
    try { sessionStorage.removeItem(JOIN_KEY); } catch (e) { /* private mode */ }
    try {
      var u = new URL(window.location.href); u.searchParams.delete('join');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* old browser: the token stays in the URL, harmless */ }
  }

  async function startJoin(token) {
    var w = window.lfgWidget;
    w.modal.classList.add('co');
    w.modal.innerHTML = '<div class="lfgw-co-spin"><span class="lfgw-spinner"></span>Loading your saved spot…</div>';
    w.show();
    try { if (window.lfg.getSettledSession) await window.lfg.getSettledSession(); } catch (e) { /* signed out */ }
    var r = await api('/api/friends?token=' + encodeURIComponent(token));
    drawJoin(token, (r && r.data) || {}, r && r.ok);
  }

  function drawJoin(token, d, ok) {
    var w = window.lfgWidget;
    if (!ok || !d.ok) d = { status: 'invalid' };
    var c = landingCopy(d), host = d.host_first_name || 'your friend', when = whenText(d.session);
    var v = d.viewer, actions = '', note = '';
    var html = '<div class="lfgw-eyebrow">Saved spot' + (d.status === 'active' ? ' · Sunday' : '') + '</div>' +
      '<div class="lfgw-title">' + esc(c.title) + '</div>';
    if (d.status === 'active') {
      html += '<div class="lfgw-text">' + esc(when) + ' · ' + esc(d.session.location) + '.<br>' + (d.free ? '<b>Free this Sunday.</b>' : 'Same price: <b>AED ' + esc(d.price_aed) + '</b>.') + '</div>' +
        '<div class="lfgw-text">' + d.spots_left + (d.spots_left === 1 ? ' spot' : ' spots') + ' left · held for ' +
        timeLeft(d.expires_at, Date.now()).replace(' left', '').replace('Under', 'under') + '</div>';
      if (!v) actions = btn('ghost', 'close', 'Close') + btn('primary', 'signin', 'Sign in to join');
      else if (v.is_host) { note = 'This is your invite link. Send it to your friends.'; actions = btn('ghost', 'close', 'Close') + btn('primary', 'copy', 'Copy link'); }
      else if (v.booked) { note = 'You’re already booked for this Sunday.'; actions = btn('ghost', 'close', 'Close') + '<a class="lfgw-btn lfgw-btn-primary" href="/account">My bookings</a>'; }
      else if (d.free) actions = btn('ghost', 'close', 'Close') + btn('primary', 'credit', 'Join free');
      else if (v.credits > 0) actions = btn('ghost', 'card', 'Pay AED ' + esc(d.price_aed)) + btn('primary', 'credit', 'Use 1 credit');
      else actions = btn('ghost', 'close', 'Close') + btn('primary', 'card', 'Pay AED ' + esc(d.price_aed));
    } else {
      var canBook = d.session && d.status !== 'closed' && d.status !== 'invalid';
      html += '<div class="lfgw-text">' + esc(c.text) + (canBook ? ' You can still book this Sunday the normal way.' : '') + '</div>';
      actions = btn('ghost', 'close', 'Close') + btn('primary', canBook ? 'normal' : 'browse', canBook ? 'Book this Sunday' : 'See the next Sunday');
    }
    w.modal.classList.add('co');
    w.modal.innerHTML = html + (note ? '<div class="lfgw-text"><b>' + esc(note) + '</b></div>' : '') +
      '<div class="lfgw-actions">' + actions + '</div><div class="lfgw-terms">' + w.terms + '</div>';
    w.show();

    function on(act, fn) { var b = w.modal.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener('click', fn); }
    on('close', function () { clearJoin(); w.close(); });
    on('browse', function () { clearJoin(); w.close(); var el = document.getElementById('bootcamps'); if (el) el.scrollIntoView({ behavior: 'smooth' }); });
    on('normal', function () { clearJoin(); w.close(); w.book(d.session.id); });
    on('signin', function () {
      var back = '/bootcamp?join=' + token;
      try {
        sessionStorage.removeItem('lfg_book_after_login');
        sessionStorage.setItem('lfg_book_return_path', back);
        sessionStorage.setItem(JOIN_KEY, token);
      } catch (e) { /* the ?next= below carries it anyway */ }
      window.location.href = '/login?next=' + encodeURIComponent(back);
    });
    on('copy', function (e) {
      var b = e.currentTarget, link = window.location.origin + '/bootcamp?join=' + token;
      var tmp = document.createElement('input'); tmp.value = link; w.modal.appendChild(tmp);
      copy(link, tmp).then(function (okc) { tmp.remove(); b.textContent = okc ? 'Copied' : 'Copy failed'; });
    });
    on('credit', async function (e) {
      var b = e.currentTarget;
      if (w.whatsapp && !(await w.whatsapp())) return;
      b.disabled = true; b.textContent = 'Booking…';
      var r = await post('/api/book', { join: token });
      if (r.ok && r.data && r.data.ok) {
        clearJoin();
        w.result('You’re in.', 'Station <b>' + esc(r.data.section) + '</b> with ' + esc(host) + ' · ' + esc(when) +
          '<br><br>' + (d.free ? 'This Sunday is free. Nothing to pay.' : 'Credits left: <b>' + esc(r.data.credits_left) + '</b>'));
        w.refresh();
      } else {
        w.toast((r.data && r.data.error) || 'Could not book', true);
        startJoin(token);
      }
    });
    on('card', async function (e) {
      var b = e.currentTarget;
      if (w.whatsapp && !(await w.whatsapp())) return;
      b.disabled = true;
      w.checkout({ kind: 'single', join: token }, {
        title: 'Station ' + esc(d.station) + ' with ' + esc(host) + ' · ' + esc(when),
        onSuccess: function () {
          clearJoin();
          w.result('Payment confirmed.', 'You’re on <b>Station ' + esc(d.station) + '</b> with ' + esc(host) + ', ' + esc(when) + '.<br>It’s in <b>My bookings</b>.');
          w.refresh();
        },
        onBack: function () { startJoin(token); }
      });
    });
  }
  function btn(kind, act, label) { return '<button type="button" class="lfgw-btn lfgw-btn-' + kind + '" data-act="' + act + '">' + label + '</button>'; }

  window.lfgFriends = { mount: mount, state: state, reset: reset, afterBooking: afterBooking, mountAccount: mountAccount };

  function boot() {
    var t = joinToken();
    if (!t || !window.lfgWidget) return;
    // A normal booking left half-done must not open over the invite after the widget loads.
    try { sessionStorage.removeItem('lfg_book_after_login'); } catch (e) { /* private mode */ }
    startJoin(t);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
