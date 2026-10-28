/* LFG back office motion layer, run-club admin.
   Loads before the admin's main script. It never calls into that script: it watches the
   DOM the script writes (views shown, numbers set, lists rendered) and animates the change.
   Grammar and timings: codexr-ui-lab dashboard-choreography / dashboard-skins / glass-navigation,
   recorded in BACKOFFICE-DESIGN.md. Remove the <script> tag to turn all of it off. */
(function () {
  'use strict';

  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mqMobile = window.matchMedia('(max-width: 960px)');
  var mqHover = window.matchMedia('(hover: hover) and (pointer: fine)');
  var RM = function () { return mqReduce.matches; };
  var EASE = 'cubic-bezier(.25,1,.5,1)';      // quart out: pills, resolves
  var T = { shellStart: 50, shellGap: 65, shellDur: 240, contentAt: 190, contentGap: 50, contentDur: 220, count: 1400 };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    sget: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    sset: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  function play(el, kf, o) {
    if (!el || !el.animate) return null;
    try { return el.animate(kf, o); } catch (e) { return null; }
  }
  // blur-to-sharp resolve, the base unit of the choreography (small or card-sized elements only)
  function resolve(el, delay, dur, blur) {
    if (RM()) return play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: delay * 0.35, easing: 'linear', fill: 'backwards' });
    return play(el, [{ opacity: 0, filter: 'blur(' + (blur || 4) + 'px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: dur || T.contentDur, delay: delay, easing: EASE, fill: 'backwards' });
  }
  function rise(el, delay, dur, y) {
    if (RM()) return play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: delay * 0.35, easing: 'linear', fill: 'backwards' });
    return play(el, [{ opacity: 0, transform: 'translateY(' + (y || 6) + 'px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: dur || T.shellDur, delay: delay, easing: EASE, fill: 'backwards' });
  }

  /* ---------- icons: one 1.5 px line family ---------- */
  var ICON = {
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    overview: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.6"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.6"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.6"/>',
    bootcamp: '<path d="M9 9.6V8a3 3 0 0 1 6 0v1.6"/><circle cx="12" cy="15" r="5.5"/>',
    members: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M15.8 4.8a3.4 3.4 0 0 1 0 6.4"/><path d="M18.2 14.4A6.2 6.2 0 0 1 21.2 20"/>',
    schedule: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    runs: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
    padel: '<circle cx="13.5" cy="9" r="5.6"/><path d="m9.6 13-5.4 5.4"/><path d="M12 7.4h.01M15 7.4h.01M13.5 10.4h.01"/><circle cx="19.2" cy="18.6" r="1.5"/>',
    trips: '<path d="M2.8 19.5 9.4 8.2l3.9 6.3 2.6-3.7 5.3 8.7Z"/><circle cx="17.4" cy="5.4" r="1.7"/>',
    events: '<path d="M3.5 8.5v-2A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v2a2.5 2.5 0 0 0 0 5v2A1.5 1.5 0 0 1 19 17H5a1.5 1.5 0 0 1-1.5-1.5v-2a2.5 2.5 0 0 0 0-5Z"/><path d="M14.5 5v2.4M14.5 9.8v2.4M14.5 14.6V17"/>',
    leads: '<path d="M3.5 13.5 6.1 5.6A1.5 1.5 0 0 1 7.5 4.5h9a1.5 1.5 0 0 1 1.4 1.1l2.6 7.9"/><path d="M3.5 13.5V18A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5H15a3 3 0 0 1-6 0Z"/>',
    sponsored: '<circle cx="12" cy="9" r="5.5"/><path d="m8.7 13.4-1.5 7.1 4.8-2.6 4.8 2.6-1.5-7.1"/>',
    orders: '<path d="M8.6 3.6 4 6.1l-1.5 4.5L6 12v8.4h12V12l3.5-1.4L20 6.1l-4.6-2.5a3.4 3.4 0 0 1-6.8 0Z"/>',
    reviews: '<path d="m12 3.6 2.6 5.2 5.8.9-4.2 4.1 1 5.7L12 16.8l-5.2 2.7 1-5.7-4.2-4.1 5.8-.9Z"/>',
    promos: '<path d="M3.5 12.4V4.9a1.4 1.4 0 0 1 1.4-1.4h7.5l8.1 8.1a1.4 1.4 0 0 1 0 2l-6.5 6.5a1.4 1.4 0 0 1-2 0Z"/><circle cx="8" cy="8" r="1.4"/>',
    notify: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 2H4.4Z"/><path d="M10 20.6a2.2 2.2 0 0 0 4 0"/>',
    ok: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',
    err: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v5.2M12 16.2v.1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>',
    x: '<path d="M7 7l10 10M17 7 7 17"/>',
    up: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
    down: '<path d="M7 7l10 10M17 8.5V17H8.5"/>',
    flat: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>'
  };
  function svg(name, sw) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.5) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICON[name] || '') + '</svg>';
  }

  /* ---------- toasts: replace window.alert, announce politely ---------- */
  var toast = (function () {
    var root, bg, live, alive, cur = null, timer = 0, shown = false, paused = false;
    function ensure() {
      if (root) return;
      root = document.createElement('div');
      root.className = 'bo-toast'; root.style.opacity = '0'; root.hidden = true;
      root.innerHTML = '<div class="bo-toast-bg"></div>';
      bg = root.firstChild;
      live = document.createElement('div'); live.className = 'bo-sr'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
      alive = document.createElement('div'); alive.className = 'bo-sr'; alive.setAttribute('role', 'alert');
      document.body.appendChild(root); document.body.appendChild(live); document.body.appendChild(alive);
      root.addEventListener('pointerenter', function () { paused = true; clearTimeout(timer); });
      root.addEventListener('pointerleave', function () { paused = false; arm(); });
      root.addEventListener('focusin', function () { paused = true; clearTimeout(timer); });
      root.addEventListener('focusout', function () { paused = false; arm(); });
    }
    function arm() {
      clearTimeout(timer);
      if (!cur || cur.sticky || paused) return;
      timer = setTimeout(hide, cur.ms);
    }
    function show(msg, tone, o) {
      o = o || {};
      ensure();
      var text = String(msg == null ? '' : msg).trim() || (tone === 'err' ? 'That did not work. Try again.' : 'Done.');
      var sticky = o.sticky != null ? o.sticky : tone === 'err';
      var row = document.createElement('div');
      row.className = 'bo-toast-row';
      row.innerHTML = '<span class="bo-toast-ico">' + svg(tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : 'info', 1.6) + '</span><span class="bo-toast-msg"></span>';
      row.querySelector('.bo-toast-msg').textContent = text;
      if (o.action && o.action.label) {
        var act = document.createElement('button');
        act.type = 'button'; act.className = 'bo-toast-act'; act.textContent = o.action.label;
        act.addEventListener('click', function () { try { o.action.run(act); } catch (e) { /* keep the toast */ } });
        row.appendChild(act);
      }
      if (sticky) {
        var x = document.createElement('button');
        x.type = 'button'; x.className = 'bo-toast-x'; x.setAttribute('aria-label', 'Close message'); x.innerHTML = svg('x', 1.8);
        x.addEventListener('click', function () { hide(); });
        row.appendChild(x);
      }
      root.hidden = false;
      root.dataset.tone = tone;
      var prev = root.querySelector('.bo-toast-row');
      root.appendChild(row);
      // width morph: the plate is clipped to the new message's width
      var W = root.clientWidth || 360;
      var w = Math.min(W, Math.ceil(row.scrollWidth));
      var inner = row.querySelector('.bo-toast-msg');
      var natural = Math.ceil(inner.getBoundingClientRect().width) + (row.children.length - 1) * 40 + 34;
      w = Math.min(W, Math.max(180, natural));
      var side = Math.max(0, (W - w) / 2);
      var clip = 'inset(0px ' + side.toFixed(1) + 'px round 18px)';
      row.style.paddingInline = (side + 14) + 'px';
      if (!shown) {
        // a hide still fading (or its fill) would sit on top of this entrance and blank it
        if (root.getAnimations) root.getAnimations().forEach(function (an) { an.cancel(); });
        $$('.bo-toast-row', root).forEach(function (r) { if (r !== row) r.remove(); });
        bg.style.clipPath = clip;
        root.style.opacity = '1';
        play(root, RM() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
      } else {
        var from = getComputedStyle(bg).clipPath;
        bg.style.clipPath = clip;
        if (!RM() && from && from !== 'none') play(bg, [{ clipPath: from }, { clipPath: clip }], { duration: 260, easing: EASE });
        if (prev) {
          var out = play(prev, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
          if (out && out.finished) out.finished.then(function () { prev.remove(); }, function () { prev.remove(); }); else prev.remove();
        }
        play(row, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: 60, easing: EASE, fill: 'backwards' });
      }
      shown = true;
      cur = { sticky: sticky, ms: o.ms || (tone === 'info' ? 6000 : 4500) };
      var region = tone === 'err' ? alive : live;
      region.textContent = '';
      setTimeout(function () { region.textContent = text; }, 40);
      arm();
    }
    function hide() {
      clearTimeout(timer);
      if (!shown || !root) return;
      shown = false; cur = null;
      var a = null;
      var end = function () { if (shown) return; root.style.opacity = '0'; root.hidden = true; if (a) a.cancel(); $$('.bo-toast-row', root).forEach(function (r) { r.remove(); }); };
      if (RM()) { end(); return; }
      a = play(root, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      if (a && a.finished) a.finished.then(end, end); else end();
    }
    return {
      ok: function (m, o) { show(m, 'ok', o); },
      err: function (m, o) { show(m, 'err', o); },
      info: function (m, o) { show(m, 'info', o); },
      hide: hide
    };
  })();
  window.lfgToast = toast;

  /* ---------- count-ups: numbers move only when they changed ---------- */
  var NUM_RE = /^(\D{0,6}?)([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?(?:%|pp|k|x|h|kg)?)$/i;
  var COUNT_SEL = '#view-today .today-card-value, #kpis .kpi .v, .runs-summary .rs-k, .lead-money .lm-v, #td-ci-here-count, #td-ci-notyet-count';
  var counters = new WeakMap();
  var buildingUntil = 0;
  function parseNum(text) {
    var m = NUM_RE.exec(String(text).trim());
    if (!m) return null;
    var intPart = m[3], dec = m[4] || '';
    return {
      pre: m[1], sign: m[2], commas: intPart.indexOf(',') >= 0, decimals: dec ? dec.length - 1 : 0, suf: m[5] || '',
      value: parseFloat((m[2] === '-' ? '-' : '') + intPart.replace(/,/g, '') + dec)
    };
  }
  function fmtNum(p, v) {
    var abs = Math.abs(v);
    var s = p.decimals ? abs.toFixed(p.decimals) : String(Math.round(abs));
    if (p.commas || abs >= 10000) {
      var parts = s.split('.');
      parts[0] = Number(parts[0]).toLocaleString('en-US');
      s = parts.join('.');
    }
    var sign = v < 0 ? '-' : (p.sign === '+' ? '+' : '');
    return p.pre + sign + s + p.suf;
  }
  function labelKey(el) {
    var card = el.closest('.today-card, .kpi, .rs-card, .lm-card, .td-ci-col');
    var lab = card && card.querySelector('.today-card-label, .l, .rs-l, .lm-l, .td-ci-col-h');
    var key = (lab ? lab.textContent : el.id || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
    return key ? 'bo:v:' + key : null;
  }
  // true when the element still holds the tick/sr pair this layer wrote, i.e. the mutation was ours
  function isOwnCount(el) {
    var c = counters.get(el);
    var sr = el.lastElementChild;
    return !!(c && c.final != null && el.firstElementChild && el.firstElementChild.classList.contains('bo-tick') && sr && sr.classList.contains('bo-sr') && sr.textContent === c.final);
  }
  function countTo(el, finalText) {
    if (isOwnCount(el)) return;
    var p = parseNum(finalText);
    var c = counters.get(el);
    if (c && c.raf) cancelAnimationFrame(c.raf);
    if (!p) { counters.set(el, { last: null, final: null }); return; }
    var key = labelKey(el);
    var from = c && c.last != null ? c.last : (key && store.get(key) != null ? parseFloat(store.get(key)) : 0);
    if (key) store.set(key, String(p.value));
    var to = p.value;
    var small = Math.abs(to) < 10 && Math.abs(from) < 10;
    var state = { last: to, raf: 0, final: finalText, p: p, pendingFrom: null };
    counters.set(el, state);
    el.innerHTML = '<span class="bo-tick" aria-hidden="true"></span><span class="bo-sr"></span>';
    var tick = el.firstChild;
    el.lastChild.textContent = finalText;
    tick.textContent = finalText;
    if (RM() || !isFinite(from) || from === to) return;
    if (el.id === 'td-ci-here-count' || el.id === 'td-ci-notyet-count') { bump(el); return; }
    if (small) return;
    // a number written while its view is hidden waits, so the count plays where it can be seen
    if (el.offsetParent === null) { state.pendingFrom = from; return; }
    runCount(el, state, from);
  }
  function runCount(el, state, from) {
    var p = state.p, to = state.last, finalText = state.final;
    var tick = el.firstChild;
    if (!tick || !tick.classList || !tick.classList.contains('bo-tick')) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    var dur = Math.min(T.count, 600 + Math.min(800, Math.abs(to - from) * 40));
    var delay = Math.max(0, buildingUntil - performance.now());
    var t0 = performance.now() + delay;
    tick.textContent = fmtNum(p, from);
    var step = function (now) {
      var k = Math.min(1, Math.max(0, (now - t0) / dur));
      var e = 1 - Math.pow(1 - k, 4);
      tick.textContent = k >= 1 ? finalText : fmtNum(p, from + (to - from) * e);
      if (k < 1) state.raf = requestAnimationFrame(step); else state.raf = 0;
    };
    state.raf = requestAnimationFrame(step);
  }
  function replayCounts(sec) {
    $$(COUNT_SEL, sec).forEach(function (el) {
      var st = counters.get(el);
      if (st && st.pendingFrom != null && el.offsetParent !== null) {
        var from = st.pendingFrom;
        st.pendingFrom = null;
        runCount(el, st, from);
      }
    });
  }
  function bump(el) {
    play(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 420, easing: EASE });
  }

  /* delta chips: "-68% vs last week" -> [arrow -68%] vs last week, tone from the app's class */
  var DELTA_RE = /^([+-]\d[\d,.]*\s?(?:%|pp)?)\s+(.+)$/;
  function chipDelta(el) {
    if (el.querySelector('.bo-chip')) return;
    var text = el.textContent.trim();
    var m = DELTA_RE.exec(text);
    if (!m) return;
    var n = parseFloat(m[1].replace(/[,%p\s+]/g, ''));
    var dir = !n ? 'flat' : n > 0 ? 'up' : 'down';
    var tone = el.classList.contains('up') ? 'up' : el.classList.contains('down') ? 'down' : 'flat';
    el.innerHTML = '<span class="bo-chip ' + tone + '">' + svg(dir, 2) + '<span></span></span><span class="bo-delta-rest"></span>';
    el.querySelector('.bo-chip span').textContent = m[1];
    el.querySelector('.bo-delta-rest').textContent = m[2];
  }

  /* ---------- sidebar: icons, nav wrapper, sliding pill, hover layer ---------- */
  var nav, pill, hover;
  function buildNav() {
    var sb = $('.sidebar');
    var btns = $$('.sidebar > .nav-btn');
    if (!sb || !btns.length) return;
    nav = document.createElement('nav');
    nav.className = 'bo-nav'; nav.setAttribute('aria-label', 'Admin sections');
    pill = document.createElement('span'); pill.className = 'bo-pill'; pill.setAttribute('aria-hidden', 'true');
    hover = document.createElement('span'); hover.className = 'bo-hover'; hover.setAttribute('aria-hidden', 'true');
    nav.appendChild(hover); nav.appendChild(pill);
    sb.insertBefore(nav, btns[0]);
    btns.forEach(function (b) {
      nav.appendChild(b);
      var ico = b.querySelector('.ico');
      var name = b.getAttribute('data-view');
      if (ico && ICON[name]) ico.innerHTML = svg(name, 1.5);
      if (b.classList.contains('active')) b.setAttribute('aria-current', 'page');
    });
    placePill(false, true);
    // Only a change of the active tab moves the pill and scrolls the strip. Other class writes inside the
    // nav (the hover layer on every pointerleave, badges) left a phone's strip unscrollable: each swipe
    // ended with the strip sliding back to the active tab.
    var lastActive = $('.nav-btn.active', nav);
    new MutationObserver(function () {
      var now = $('.nav-btn.active', nav);
      if (now === lastActive) return;
      lastActive = now;
      $$('.nav-btn', nav).forEach(function (b) { if (b.classList.contains('active')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      placePill(true, true);
    }).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
    nav.addEventListener('pointerover', function (e) {
      if (!mqHover.matches || mqMobile.matches) return;
      var b = e.target.closest('.nav-btn');
      if (!b) return;
      hover.style.transform = 'translateY(' + b.offsetTop + 'px)';
      hover.classList.add('on');
    });
    nav.addEventListener('pointerleave', function () { hover.classList.remove('on'); });
    // A layout switch to the phone strip brings the active tab into view; a plain resize (iOS fires one
    // whenever its toolbar hides) only re-places the pill.
    var re = function () { placePill(false, true); };
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', re); else mqMobile.addListener(re);
    window.addEventListener('resize', function () { placePill(false, false); });
  }
  function placePill(animate, reveal) {
    if (!nav || !pill) return;
    var b = $('.nav-btn.active', nav);
    if (!b) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '';
    if (!animate) pill.style.transition = 'none';
    if (mqMobile.matches) {
      pill.style.width = b.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + b.offsetLeft + 'px)';
      var target = b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2;
      if (reveal && nav.scrollTo) nav.scrollTo({ left: Math.max(0, target), behavior: animate && !RM() ? 'smooth' : 'auto' });
    } else {
      pill.style.width = '';
      pill.style.height = b.offsetHeight + 'px';
      pill.style.transform = 'translateY(' + b.offsetTop + 'px)';
    }
    if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
  }

  /* ---------- views: shells, then content; full build once per view per session ---------- */
  var SHELL_SEL = '.today-grid > *, .kpis > *, .runs-summary > *, .lead-money > *, .grid2 > .card, .sched-grid > *, .view > .card, .view > .today-block, .view > .runs-header, .view > .runs-toolbar';
  function built() { try { return JSON.parse(store.sget('bo:built') || '[]'); } catch (e) { return []; } }
  function markBuilt(v) { var b = built(); if (b.indexOf(v) < 0) { b.push(v); store.sset('bo:built', JSON.stringify(b)); } }
  function enterView(sec, opts) {
    opts = opts || {};
    var v = sec.id.replace(/^view-/, '');
    var full = opts.force || built().indexOf(v) < 0;
    var t0 = opts.t0 || 0;
    sec.boEnteredAt = performance.now();
    if (sec.id !== 'view-today') endWait(true); // another view wrote its own title
    requestAnimationFrame(function () { scrollHints(sec); if (sec.id === 'view-today') holdBoardHeight(); });
    var head = $('.topbar');
    if (head) { resolve($('#view-title'), t0, 300, 6); resolve($('#view-sub'), t0 + 60, 260, 4); }
    if (!full) {
      play(sec, [{ opacity: 0 }, { opacity: 1 }], { duration: RM() ? 100 : 140, easing: 'linear' });
      drawCharts(sec, false);
      replayCounts(sec);
      return;
    }
    markBuilt(v);
    var shells = $$(SHELL_SEL, sec).filter(function (s) { return s.offsetParent !== null; });
    var rows = [], lastTop = null, slot = -1, k = 0;
    shells.forEach(function (s) {
      var top = Math.round(s.getBoundingClientRect().top / 24);
      if (top !== lastTop) { slot++; k = 0; lastTop = top; } else { k++; }
      rows.push({ el: s, slot: Math.min(slot, 8), k: k });
    });
    var maxEnd = 0;
    rows.forEach(function (r) {
      var ts = t0 + T.shellStart + r.slot * T.shellGap + r.k * 30;
      rise(r.el, ts, T.shellDur, 8);
      var kids = $$(':scope > *', r.el).slice(0, 6);
      kids.forEach(function (c, i) { resolve(c, ts + T.contentAt + i * T.contentGap, T.contentDur, 3); });
      maxEnd = Math.max(maxEnd, ts + 300);
      if ((r.el.classList.contains('today-card-primary') || r.el.matches('#kpis > .kpi:first-child')) && !RM()) {
        play(r.el, [{ clipPath: 'circle(0% at 0% 0%)' }, { clipPath: 'circle(150% at 0% 0%)' }], { duration: 520, delay: ts, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
      }
    });
    buildingUntil = performance.now() + maxEnd;
    drawCharts(sec, true);
    replayCounts(sec);
  }

  /* ---------- charts: draw in when the view is on screen, morph on refresh ---------- */
  var drawn = new WeakSet();
  function drawCharts(sec, stagger) {
    if (!window.Chart || !window.Chart.getChart) return;
    var canvases = $$('canvas', sec);
    if (!canvases.length) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        canvases.forEach(function (cv, i) {
          var ch = window.Chart.getChart(cv);
          if (!ch || drawn.has(ch)) return;
          drawn.add(ch);
          if (RM()) { try { ch.resize(); ch.update('none'); } catch (e) { /* chart gone */ } return; }
          setTimeout(function () { try { ch.resize(); ch.reset(); ch.update(); } catch (e) { /* chart gone */ } }, stagger ? 120 + i * 80 : 0);
        });
      });
    });
  }
  function hatch() {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 8;
      var x = c.getContext('2d');
      x.fillStyle = 'rgba(244,241,233,0.035)'; x.fillRect(0, 0, 8, 8);
      x.strokeStyle = 'rgba(244,241,233,0.20)'; x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(0, 8); x.lineTo(8, 0); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
      return x.createPattern(c, 'repeat');
    } catch (e) { return 'rgba(255,255,255,0.07)'; }
  }
  if (window.Chart && window.Chart.defaults) {
    var D = window.Chart.defaults;
    D.font.family = 'Barlow, sans-serif'; D.font.size = 11; D.color = '#B9B6AD';
    D.animation.duration = 900;
    D.animation.easing = 'easeOutQuart';
    D.animation.delay = function (ctx) { return ctx.type === 'data' && ctx.mode === 'default' ? Math.min(ctx.dataIndex, 16) * 70 + ctx.datasetIndex * 40 : 0; };
    D.elements.bar.borderRadius = 6;
    D.elements.line.borderWidth = 2;
    D.elements.point.hoverRadius = 5;
    var tip = D.plugins.tooltip;
    tip.backgroundColor = '#232320'; tip.borderColor = 'rgba(244,241,233,0.14)'; tip.borderWidth = 1;
    tip.titleColor = '#F4F1E9'; tip.bodyColor = '#B9B6AD'; tip.padding = 10; tip.cornerRadius = 10; tip.displayColors = false;
    tip.titleFont = { family: 'Barlow Condensed', weight: '700', size: 13 }; tip.bodyFont = { family: 'Barlow', size: 12 };
    // an all-zero doughnut draws nothing; show a hatched ring and say why instead of a blank card
    if (window.Chart.register) window.Chart.register({
      id: 'lfgEmptyRing',
      afterDraw: function (chart) {
        if (chart.config.type !== 'doughnut') return;
        var ds = chart.data.datasets[0];
        var sum = ((ds && ds.data) || []).reduce(function (a, b) { return a + (+b || 0); }, 0);
        if (sum > 0) return;
        var a = chart.chartArea, ctx = chart.ctx;
        if (!a) return;
        var cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
        var r = Math.min(a.right - a.left, a.bottom - a.top) / 2 - 4;
        if (r < 20) return;
        ctx.save();
        ctx.lineWidth = r * 0.4;
        ctx.strokeStyle = hatch();
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#B9B6AD';
        ctx.font = '700 13px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('NO BOOKINGS YET', cx, cy);
        ctx.restore();
      }
    });
  }

  /* ---------- live check-in: arrivals glide from Not yet to Here ---------- */
  var ci = { rects: new Map(), here: null, seen: null };
  function rowName(r) { var n = r.querySelector('.name'); return n ? n.textContent.trim() : ''; }
  function snapRows() {
    ci.rects.clear();
    ['td-ci-here-list', 'td-ci-notyet-list'].forEach(function (id) {
      var list = document.getElementById(id);
      if (!list) return;
      $$('.td-ci-row', list).forEach(function (r) {
        var n = rowName(r); if (!n) return;
        var b = r.getBoundingClientRect();
        ci.rects.set(n, { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height, list: id });
      });
    });
  }
  function onCheckinRender() {
    var hereList = document.getElementById('td-ci-here-list');
    if (!hereList) return;
    var nowHere = new Set($$('.td-ci-row', hereList).map(rowName).filter(Boolean));
    var arrivals = [];
    if (ci.seen) nowHere.forEach(function (n) { if (!ci.seen.has(n)) arrivals.push(n); });
    if (arrivals.length && hereList.offsetParent !== null) {
      arrivals.forEach(function (n, i) {
        var row = $$('.td-ci-row', hereList).filter(function (r) { return rowName(r) === n; })[0];
        if (!row) return;
        row.classList.add('bo-arrived');
        setTimeout(function () { row.classList.remove('bo-arrived'); }, 2600);
        var first = ci.rects.get(n);
        if (RM()) return;
        var last = row.getBoundingClientRect();
        if (first && first.list === 'td-ci-notyet-list') {
          var ghost = row.cloneNode(true);
          ghost.setAttribute('aria-hidden', 'true');
          ghost.style.cssText = 'position:fixed;z-index:60;margin:0;pointer-events:none;left:' + (first.x - window.scrollX) + 'px;top:' + (first.y - window.scrollY) + 'px;width:' + last.width + 'px;background:#232320;box-shadow:0 10px 24px -10px rgba(0,0,0,.6), inset 2px 0 0 #C2C28A;';
          document.body.appendChild(ghost);
          row.style.opacity = '0';
          var dx = last.left - (first.x - window.scrollX), dy = last.top - (first.y - window.scrollY);
          var a = play(ghost, [{ transform: 'translate(0,0)' }, { transform: 'translate(' + dx + 'px,' + dy + 'px)' }], { duration: 620, delay: i * 90, easing: EASE, fill: 'forwards' });
          var done = function () { ghost.remove(); row.style.opacity = ''; };
          if (a && a.finished) a.finished.then(done, done); else done();
        } else {
          play(row, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: i * 90, easing: EASE, fill: 'backwards' });
        }
      });
      var firstRow = $$('.td-ci-row', hereList).filter(function (r) { return rowName(r) === arrivals[0]; })[0];
      var sec = firstRow && firstRow.querySelector('.sec');
      var where = sec && sec.textContent.trim() && sec.textContent.trim() !== '—' ? ' · Station ' + sec.textContent.trim() : '';
      toast.ok(arrivals.length === 1 ? arrivals[0] + ' checked in' + where : arrivals[0] + ' and ' + (arrivals.length - 1) + ' more checked in');
    }
    stations(arrivals);
    holdBoardHeight();
    var board = document.getElementById('td-checkin-block');
    if (board && !board.boListsIn) { board.boListsIn = performance.now(); setTimeout(releaseBoard, 3000); }
    releaseBoard();
    ci.seen = nowHere;
    snapRows();
  }

  // The station map's open places come from the session's row on Bootcamp, which lands with the stats.
  // The check-in feed now starts first, so a held board also waits for that row (3 s at most) and lands
  // whole, instead of showing booked rings and growing its open places a second later.
  function capsReady() {
    var s = document.getElementById('sessions');
    return Object.keys(stationCaps()).length > 0 || !!(s && s.children.length);
  }
  function releaseBoard() {
    var board = document.getElementById('td-checkin-block');
    if (!board || !board.boListsIn) return;
    if (board.boHeld && !capsReady() && performance.now() - board.boListsIn < 2990) return;
    stations();
    releaseCard(board, true);
    rememberHeight(board);
  }

  // Each arrival moved a row across and the board shrank by that row, pulling the cards under it up.
  // Side by side, both lists now hold room for every booked runner (up to the lists' own scroll cap).
  function holdBoardHeight() {
    var lists = ['td-ci-here-list', 'td-ci-notyet-list'].map(function (id) { return document.getElementById(id); });
    if (!lists[0] || !lists[1]) return;
    var rows = $$('.td-ci-row', lists[0]).concat($$('.td-ci-row', lists[1]));
    var a = lists[0].getBoundingClientRect(), b = lists[1].getBoundingClientRect();
    var need = 0;
    if (rows.length && a.height && Math.abs(a.top - b.top) < 2) {
      var cs = getComputedStyle(lists[1]);
      var gap = parseFloat(cs.rowGap) || 0, cap = parseFloat(cs.maxHeight) || Infinity;
      need = Math.min(cap, Math.ceil(rows.length * rows[0].getBoundingClientRect().height + (rows.length - 1) * gap));
    }
    lists.forEach(function (l) { l.style.minHeight = need ? need + 'px' : ''; });
  }

  /* ---------- the door board: one ring per booked runner, by roster station ---------- */
  // Built from the rows the admin already rendered (name + station letter), so it needs no extra data.
  function stationOf(row) { var s = row.querySelector('.sec'); var t = s ? s.textContent.trim() : ''; return /^[A-Z]$/.test(t) ? t : ''; }
  // Places per station come from the same session's row on Bootcamp ("A 2/8 · B 3/8 · ..."); without it, booked rings only.
  function stationCaps() {
    var sub = ((document.getElementById('td-ci-sub') || {}).textContent || '').replace(/^(Today|Next)\s*·\s*/, '');
    var label = sub.split(' · ').slice(0, 2).join(' · ').trim();
    if (!label) return {};
    var row = $$('.sess-row').filter(function (r) { var d = r.querySelector('.sess-date'); return d && d.textContent.trim().indexOf(label) === 0; })[0];
    // no \b: the text runs together ("12:45A 2/8"), so the guard is "not preceded by a letter"
    var caps = {}, m, re = /(^|[^A-Za-z])([A-Z])\s+\d+\/(\d+)/g, txt = row ? (row.querySelector('.sess-main') || row).textContent : '';
    while ((m = re.exec(txt))) caps[m[2]] = +m[3];
    return caps;
  }
  function stations(arrivals) {
    var block = document.getElementById('td-checkin-block');
    var grid = block && block.querySelector('.td-ci-grid');
    if (!grid) return;
    var map = {}, keys = [], caps = stationCaps();
    function slot(k) { if (!map[k]) { map[k] = { here: 0, total: 0 }; keys.push(k); } return map[k]; }
    Object.keys(caps).forEach(slot);
    function add(row, here) { var s = slot(stationOf(row) || '_'); s.total++; if (here) s.here++; }
    $$('#td-ci-here-list .td-ci-row').forEach(function (r) { add(r, true); });
    $$('#td-ci-notyet-list .td-ci-row').forEach(function (r) { add(r, false); });
    var order = keys.filter(function (k) { return k !== '_'; }).sort();
    if (map._) order.push('_');
    var box = block.querySelector('.bo-stations');
    if (!order.length) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.className = 'bo-stations';
      box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Stations');
      grid.parentNode.insertBefore(box, grid);
    }
    // rewrite only when a count changed: this runs on every structural change in #app, and its own write is one
    var sig = order.map(function (k) { return k + map[k].here + '/' + map[k].total + '/' + (caps[k] || 0); }).join(',');
    if (box.boSig === sig && !(arrivals && arrivals.length)) return;
    box.boSig = sig;
    var fresh = {};
    (arrivals || []).forEach(function (n) {
      var row = $$('#td-ci-here-list .td-ci-row').filter(function (r) { return rowName(r) === n; })[0];
      if (row) { var k = stationOf(row) || '_'; fresh[k] = (fresh[k] || 0) + 1; }
    });
    var said = [];
    box.innerHTML = order.map(function (k) {
      var s = map[k], dots = '', open = Math.max(0, (caps[k] || 0) - s.total);
      for (var i = 0; i < s.total; i++) {
        var on = i < s.here, pop = on && fresh[k] && i >= s.here - fresh[k] && !RM();
        dots += '<i class="' + (on ? 'on' : '') + (pop ? ' bo-pop' : '') + '"></i>';
      }
      for (var j = 0; j < open && k !== '_'; j++) dots += '<i class="bo-open"></i>';
      if (k === '_') {
        said.push(s.total + ' waiting for a station');
        return '<div class="bo-st bo-waiting"><div class="bo-st-k"><b>' + s.total + '</b> waiting for a station</div><div class="bo-st-dots" aria-hidden="true">' + dots + '</div></div>';
      }
      said.push('Station ' + k + ', ' + s.here + ' of ' + s.total + ' here' + (open ? ', ' + open + ' open' : ''));
      return '<div class="bo-st' + (s.here && s.here === s.total ? ' bo-full' : '') + '"><div class="bo-st-letter" aria-hidden="true">' + k + '</div><div class="bo-st-dots" aria-hidden="true">' + dots + '</div><div class="bo-st-k" aria-hidden="true"><b>' + s.here + '</b> of ' + s.total + ' here' + (open ? '<span class="bo-st-open"> · ' + open + ' open</span>' : '') + '</div></div>';
    }).join('') + '<span class="bo-sr">' + said.join('. ') + '.</span>';
  }

  /* ---------- Overview tiles hold their place until the numbers land ---------- */
  function holdKpis() {
    var k = document.getElementById('kpis');
    if (!k || k.children.length) return;
    k.innerHTML = new Array(9).join('<div class="kpi bo-ph" aria-hidden="true"></div>');
    setTimeout(function () { if (k.querySelector('.bo-ph') && k.children.length === k.querySelectorAll('.bo-ph').length) k.innerHTML = ''; }, 15000);
  }

  /* ---------- late cards hold their last height, so their data lands in place ---------- */
  // The live board and the abandoned-checkout card fetch on their own and arrived seconds after their
  // view, pushing everything under them down. From the first frame each now shows as a placeholder plate
  // the height it had last time in this browser (or the measured default), and its data fills it.
  var HOLD = { 'td-checkin-block': 506, 'recon-card': 488 };
  function hKey(id) { return 'bo:h:' + id + (mqMobile.matches ? ':m' : ':d'); }
  function holdCards() {
    Object.keys(HOLD).forEach(function (id) {
      var card = document.getElementById(id);
      if (!card || card.boLoaded || card.boHeld || card.style.display !== 'none') return;
      card.boHeld = true;
      card.classList.add('bo-ph');
      card.style.minHeight = (+store.get(hKey(id)) || HOLD[id]) + 'px';
      card.style.display = '';
      card.boHoldTimer = setTimeout(function () { releaseCard(card, false); }, 15000);
    });
  }
  // loaded: the admin wrote the card (its data, or that there is none); otherwise the wait timed out
  function releaseCard(card, loaded) {
    if (!card) return;
    if (loaded) card.boLoaded = true;
    if (!card.boHeld) return;
    card.boHeld = false;
    clearTimeout(card.boHoldTimer);
    card.classList.remove('bo-ph');
    card.style.minHeight = '';
    if (!loaded) card.style.display = 'none';
  }
  function rememberHeight(card) {
    if (card && card.style.display !== 'none' && card.offsetHeight) store.set(hKey(card.id), String(card.offsetHeight));
  }

  /* ---------- a card that arrives late makes room instead of jumping the page ---------- */
  function revealLate(card) {
    var sec = card.parentElement;
    if (RM() || !sec || !sec.classList.contains('view') || sec.classList.contains('hidden')) return;
    if (performance.now() - (sec.boEnteredAt || 0) < 350) return; // still inside the view's own entrance
    var cs = getComputedStyle(card);
    var delta = card.offsetHeight + (parseFloat(cs.marginTop) || 0);
    play(card, [{ opacity: 0, clipPath: 'inset(0 0 100% 0 round 14px)' }, { opacity: 1, clipPath: 'inset(0 0 0 0 round 14px)' }], { duration: 380, easing: EASE });
    for (var n = card.nextElementSibling; n; n = n.nextElementSibling) {
      if (n.offsetParent !== null) play(n, [{ transform: 'translateY(' + (-delta) + 'px)' }, { transform: 'none' }], { duration: 380, easing: EASE });
    }
  }
  function watchLateCards() {
    $$('.view > .card').forEach(function (card) {
      var hidden = card.style.display === 'none';
      new MutationObserver(function () {
        var now = card.style.display === 'none';
        if (hidden && !now) revealLate(card);
        if (now && card.boHeld) releaseCard(card, true); // the admin decided there is nothing to show
        hidden = now;
      }).observe(card, { attributes: true, attributeFilter: ['style'] });
    });
  }

  /* ---------- wide tables say they scroll ---------- */
  function scrollHints(root) {
    $$('.tbl-wrap, [style*="overflow-x:auto"]', root || document).forEach(function (w) {
      var over = w.scrollWidth > w.clientWidth + 2;
      w.classList.toggle('bo-scrollx', over);
      if (!over) return;
      var edge = function () { w.classList.toggle('bo-at-end', w.scrollLeft + w.clientWidth >= w.scrollWidth - 2); };
      if (!w.boHinted) { w.boHinted = true; w.addEventListener('scroll', edge, { passive: true }); }
      edge();
    });
  }

  /* ---------- Today leads with the next session's turnout ---------- */
  var DAYS = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
  function todayHeadline() {
    var title = document.getElementById('view-title'), sub = document.getElementById('view-sub');
    var today = document.getElementById('view-today');
    if (!title || !sub || !today || today.classList.contains('hidden')) return;
    var when = ((document.getElementById('td-next-when') || {}).textContent || '').trim();
    var m = /(\d+)\s*\/\s*(\d+)\s*booked\s*·\s*(\d+)h to go/.exec((document.getElementById('td-next-fill') || {}).textContent || '');
    if (!m) { if (when && when !== '—') endWait(); return; } // the numbers came back with no session
    var booked = +m[1], cap = +m[2], h = +m[3];
    var who = h < 12 ? 'today' : (h <= 144 && DAYS[when.slice(0, 3)]) ? DAYS[when.slice(0, 3)] : when.split('·')[0].trim();
    var full = booked >= cap;
    var head = full ? (h < 12 ? 'Today is full' : who + ' is full') : booked + ' booked for ' + who;
    var left = full ? cap + ' of ' + cap + ' booked' : (cap - booked) + (cap - booked === 1 ? ' place' : ' places') + ' left';
    var line = when + ' · ' + left + ' · ' + (h < 24 ? 'in ' + h + 'h' : 'in ' + Math.round(h / 24) + ' days');
    if (title.textContent !== head) title.textContent = head;
    if (sub.textContent !== line) sub.textContent = line;
    endWait();
  }
  // A signed-in reload painted the default "Today / What needs your attention right now" for the second
  // the numbers took, then swapped it. Until they land, the title and its line wait as plates instead.
  function waitHeadline() {
    var title = document.getElementById('view-title'), sub = document.getElementById('view-sub');
    var fill = (document.getElementById('td-next-fill') || {}).textContent || '';
    if (!title || !sub || title.boWaited || /booked/.test(fill)) return;
    title.boWaited = true;
    title.classList.add('bo-wait'); sub.classList.add('bo-wait');
    setTimeout(endWait, 4000);
  }
  function endWait(quiet) {
    $$('.topbar .bo-wait').forEach(function (n, i) { n.classList.remove('bo-wait'); if (!quiet) resolve(n, i * 60, 240, 4); });
  }
  function watchHeadline() {
    var title = document.getElementById('view-title'), fill = document.getElementById('td-next-fill');
    var mo = new MutationObserver(function () { todayHeadline(); });
    if (title) mo.observe(title, { childList: true, characterData: true, subtree: true });
    if (fill) mo.observe(fill, { childList: true, characterData: true, subtree: true });
    todayHeadline();
  }

  /* ---------- abandoned checkouts: six rows, the rest one tap away ---------- */
  var reconOpen = false;
  function clampRecon() {
    var list = document.getElementById('recon-list');
    if (!list) return;
    var card = document.getElementById('recon-card');
    releaseCard(card, true);
    var n = list.children.length;
    var btn = document.getElementById('bo-recon-more');
    if (n <= 6) { list.classList.remove('bo-clamped'); if (btn) btn.hidden = true; rememberHeight(card); return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'bo-recon-more'; btn.className = 'btn-ghost bo-more';
      btn.addEventListener('click', function () { reconOpen = !reconOpen; clampRecon(); });
      list.parentNode.insertBefore(btn, list.nextSibling);
    }
    btn.hidden = false;
    list.classList.toggle('bo-clamped', !reconOpen);
    btn.textContent = reconOpen ? 'Show fewer' : 'Show all ' + n;
    if (!reconOpen) rememberHeight(card); // the clamped height is the one a fresh load shows
    btn.setAttribute('aria-expanded', String(reconOpen));
  }

  /* ---------- cells the admin made clickable by hand become keyboard controls ---------- */
  var sortFocus = null;
  function reachable() {
    $$('th.promo-sort').forEach(function (th) {
      if (th.querySelector('.bo-th-btn')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'bo-btn bo-th-btn';
      while (th.firstChild) b.appendChild(th.firstChild);
      th.appendChild(b); // the click bubbles to the header's own sort listener
      b.addEventListener('click', function () { sortFocus = document.activeElement === b ? th.getAttribute('data-sort') : null; });
      if (sortFocus && sortFocus === th.getAttribute('data-sort')) { sortFocus = null; b.focus({ preventScroll: true }); }
    });
    var lap = document.getElementById('kpi-lapsed');
    if (lap && lap.style.cursor === 'pointer' && !lap.hasAttribute('tabindex')) {
      lap.tabIndex = 0; lap.setAttribute('role', 'button');
      lap.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lap.click(); } });
    }
  }

  /* ---------- modals: Escape closes, focus goes in and comes back ---------- */
  // Escape presses the modal's own Close/Cancel button, so the admin's close logic runs unchanged.
  // The snooze modal already handles Escape itself.
  function watchModals() {
    var opener = new WeakMap();
    $$('.modal-bg').forEach(function (bg) {
      var box = bg.querySelector('.modal');
      if (box) {
        var h = box.querySelector('h2, h3');
        box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.tabIndex = -1;
        if (h) box.setAttribute('aria-label', h.textContent.trim());
      }
      new MutationObserver(function () {
        var open = bg.classList.contains('show');
        if (open && !opener.has(bg)) {
          opener.set(bg, document.activeElement);
          if (box) box.focus({ preventScroll: true });
        } else if (!open && opener.has(bg)) {
          var o = opener.get(bg); opener.delete(bg);
          if (o && o.focus && document.contains(o)) o.focus({ preventScroll: true });
        }
      }).observe(bg, { attributes: true, attributeFilter: ['class'] });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      var open = $$('.modal-bg.show').filter(function (bg) { return bg.id !== 'snooze-bg'; });
      var top = open[open.length - 1];
      var close = top && $$('button', top).filter(function (b) { return /^(close|cancel)$/i.test(b.textContent.trim()); })[0];
      if (close) { e.preventDefault(); close.click(); }
    });
  }

  /* ---------- browser Back moves between views; reload keeps the view ---------- */
  var routing = false;
  function viewBtn(v) { return v ? document.querySelector('.nav-btn[data-view="' + v.replace(/[^a-z-]/g, '') + '"]') : null; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.nav-btn');
    if (!b || routing) return;
    var v = b.getAttribute('data-view');
    if (v && location.hash.slice(1) !== v) {
      try { history.pushState({ boView: v }, '', '#' + v); } catch (err) { /* file:// */ }
    }
  }, true);
  window.addEventListener('popstate', function () {
    var b = viewBtn(location.hash.slice(1) || 'today');
    if (b && !b.classList.contains('active')) { routing = true; b.click(); routing = false; }
  });
  function openFromHash() {
    var v = location.hash.slice(1);
    var b = viewBtn(v);
    if (b && !b.classList.contains('active')) { routing = true; b.click(); routing = false; }
  }

  /* ---------- one observer for everything the admin script writes ---------- */
  function watch() {
    var app = document.getElementById('app');
    if (!app) return;
    var opened = !app.classList.contains('hidden');
    var lastView = null;
    function chrome() {
      var first = store.sget('bo:chrome') !== '1';
      store.sset('bo:chrome', '1');
      var sb = $('.sidebar');
      if (first && sb) {
        if (!RM()) play(sb, [{ opacity: 0, transform: mqMobile.matches ? 'translateY(-8px)' : 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE, fill: 'backwards' });
        $$('.nav-btn', nav || sb).forEach(function (b, i) { resolve(b, 120 + i * 40, 220, 4); });
        if (pill) play(pill, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 300, easing: 'linear', fill: 'backwards' });
        $$('.topbar-actions > *').forEach(function (b, i) { resolve(b, 200 + i * 50, 240, 4); });
      }
      placePill(false, true);
      return first ? 220 : 0;
    }
    function current() { return $$('.view').filter(function (s) { return !s.classList.contains('hidden'); })[0]; }
    function onAppShown() {
      document.documentElement.classList.remove('bo-resuming');
      holdKpis();
      holdCards();
      var t0 = chrome();
      openFromHash();
      var sec = current();
      if (sec && sec.id === 'view-today') waitHeadline();
      if (sec) { lastView = sec.id; enterView(sec, { t0: t0 }); }
    }
    new MutationObserver(function () {
      var now = !app.classList.contains('hidden');
      if (now && !opened) { opened = true; onAppShown(); }
      if (!now) opened = false;
    }).observe(app, { attributes: true, attributeFilter: ['class'] });
    if (opened) onAppShown();

    $$('.view').forEach(function (sec) {
      new MutationObserver(function () {
        if (sec.classList.contains('hidden') || sec.id === lastView || !opened) return;
        lastView = sec.id;
        enterView(sec);
      }).observe(sec, { attributes: true, attributeFilter: ['class'] });
    });

    var body = document.getElementById('app');
    new MutationObserver(function (muts) {
      var ciTouched = false, reconTouched = false, structural = false;
      var seen = new Set();
      muts.forEach(function (m) {
        if (m.type === 'childList') structural = true;
        var t = m.target.nodeType === 3 ? m.target.parentNode : m.target;
        if (!t || !t.closest) return;
        if (t.closest('.bo-tick') || t.closest('.bo-chip')) return;
        if (t.id === 'td-ci-here-list' || t.id === 'td-ci-notyet-list' || t.closest('#td-ci-here-list, #td-ci-notyet-list')) ciTouched = true;
        if (t.id === 'recon-list') reconTouched = true;
        var candidates = [];
        if (t.matches && t.matches(COUNT_SEL)) candidates.push(t);
        if (m.type === 'childList') m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches(COUNT_SEL)) candidates.push(n); candidates = candidates.concat($$('.v, .rs-k, .lm-v', n).filter(function (x) { return x.matches(COUNT_SEL); })); } });
        candidates.forEach(function (c) { if (!seen.has(c) && !isOwnCount(c)) { seen.add(c); countTo(c, c.textContent.trim()); } });
        var delta = t.closest('.today-card-delta');
        if (delta) chipDelta(delta);
      });
      if (ciTouched) onCheckinRender();
      if (reconTouched) clampRecon();
      if (structural) { reachable(); if (!ciTouched) { stations(); releaseBoard(); } }
    }).observe(body, { childList: true, characterData: true, subtree: true });
  }

  window.lfgFx = { toast: toast, hatch: hatch, svg: svg };

  try { buildNav(); } catch (e) { /* the admin works without the layer */ }
  try { holdKpis(); } catch (e) { /* the admin works without the layer */ }
  try { watch(); } catch (e) { /* the admin works without the layer */ }
  try { watchModals(); } catch (e) { /* the admin works without the layer */ }
  try { watchLateCards(); } catch (e) { /* the admin works without the layer */ }
  try { watchHeadline(); } catch (e) { /* the admin works without the layer */ }
  window.addEventListener('resize', function () { var v = $$('.view').filter(function (s) { return !s.classList.contains('hidden'); })[0]; if (v) scrollHints(v); holdBoardHeight(); });
})();
