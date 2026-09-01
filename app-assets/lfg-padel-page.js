/* ============================================================
   LFG PADEL TUESDAYS — page behavior
   The match ball (the page's signature), reveal choreography,
   next-Tuesday date, FAQ, and the preview booking drawer.
   No libraries: this repo is static HTML + vanilla JS by design.
   ============================================================ */
(function () {
  'use strict';

  // Reveal-hiding only exists once JS is here (see .pd-reveal in the CSS).
  document.documentElement.classList.add('pd-js');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- next Tuesday, Dubai time ---------- */
  function nextTuesday() {
    // Now in Asia/Dubai regardless of the visitor's zone.
    var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
    var day = now.getDay(); // Tue = 2
    var add = (2 - day + 7) % 7;
    // If it's already Tuesday evening (after 21:00), point at next week.
    if (add === 0 && now.getHours() >= 21) add = 7;
    var t = new Date(now);
    t.setDate(now.getDate() + add);
    return t;
  }
  /* solid nav once the hero is left behind */
  var nav = document.querySelector('.pd-nav');
  if (nav) {
    var navTick = false;
    window.addEventListener('scroll', function () {
      if (navTick) return;
      navTick = true;
      requestAnimationFrame(function () {
        nav.classList.toggle('scrolled', window.scrollY > 60);
        navTick = false;
      });
    }, { passive: true });
  }

  var tue = nextTuesday();
  var dateEl = document.getElementById('pdDate');
  if (dateEl) {
    dateEl.textContent = tue.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  /* ---------- reveal choreography ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.pd-reveal'));
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var delay = parseInt(el.getAttribute('data-delay') || '0', 10);
        setTimeout(function () { el.classList.add('in'); }, delay);
        io.unobserve(el);
      });
    }, { threshold: 0.18 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }
  // Print, save-as, and any non-scrolling render get everything.
  window.addEventListener('beforeprint', function () {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  });

  /* ============================================================
     THE MATCH BALL — scroll-driven ballistics

     The first version lerped between waypoints and lifted the ball
     with a sine arc, which is why it read like a sticker on a rail.
     This one solves the real thing between each pair of anchors:

       · horizontal velocity is constant (no drag on a 12m flight)
       · vertical is a chain of parabolas, each apex e² of the last
       · flight TIME also shrinks by e, so the bounces bunch up at
         the end exactly the way a dropped ball does
       · the ball spins at the rate its own circumference implies
         for the distance covered — the cue that sells weight
       · impact squash is proportional to the landing speed, so the
         first bounce hits hard and the fourth barely dents
       · the floor shadow tightens and darkens as the ball drops

     Scroll is still the clock, so all of it scrubs backwards too.
     e = 0.68: a pressurised padel ball returns roughly two thirds
     of its drop height off a hard court.
     ============================================================ */
  var ball = document.getElementById('pdBall');
  var ballCore = document.getElementById('pdBallCore');
  var ballImg = ballCore && ballCore.querySelector('img');
  var ballShadow = document.getElementById('pdBallShadow');
  if (ball && ballCore && ballImg && !reduced) {
    var E = 0.68;          // coefficient of restitution
    var BOUNCES = 4;       // impacts between one anchor and the next
    var APEX = 0.24;       // first apex, as a fraction of the viewport

    // At 390px the ball is a quarter of the screen wide, so a trajectory that
    // crosses the content column puts white type over yellow felt and nothing
    // is readable — z-order does not save it, the text wins the paint and
    // still can't be read. COMPOSITION.md called this from the start ("ball
    // trajectory reduced to edge bounces at seams"); this implements it: on
    // narrow screens the ball rides the gap BELOW each block, hugging the
    // gutter, with the apex cut so it never arcs back up through the copy.
    var narrow = false;
    var SEAM_APEX = 0.09;

    // Phones sample scroll far more coarsely than they paint, so four bounces
    // squeezed into a short seam gap move several degrees of arc between
    // samples and read as jitter rather than bounce. Two bounces over the same
    // gap travel less per sample and stay legible.
    var NARROW_BOUNCES = 2;

    // Time and height shares of each bounce, normalised for the current count.
    var share = [], cum = [0], bounces = 0;
    function setBounces(n) {
      if (n === bounces) return;
      bounces = n;
      share = []; cum = [0];
      var total = 0, k;
      for (k = 0; k < n; k++) { share[k] = Math.pow(E, k); total += share[k]; }
      for (k = 0; k < n; k++) {
        share[k] /= total;
        cum[k + 1] = cum[k] + share[k];
      }
    }
    setBounces(BOUNCES);

    var anchors = Array.prototype.slice.call(document.querySelectorAll('[data-ball-stop]'));
    var stops = [];
    var vw = 0, vh = 0, docH = 0;
    var ballSize = 132;

    function measure() {
      vw = window.innerWidth;
      vh = window.innerHeight;
      docH = document.documentElement.scrollHeight - vh;
      ballSize = ball.offsetWidth || 132;
      narrow = vw <= 760;
      setBounces(narrow ? NARROW_BOUNCES : BOUNCES);
      stops = anchors.map(function (el) {
        var r = el.getBoundingClientRect();
        var docTop = r.top + window.scrollY;
        var side = el.getAttribute('data-ball-side') || 'right';
        var scale = parseFloat(el.getAttribute('data-ball-scale') || '1');
        var x;
        if (narrow) {
          // Hug whichever gutter the anchor asked for; never the middle.
          x = side === 'left' ? 6 : vw - ballSize - 6;
        } else if (side === 'left') x = Math.max(16, r.left - ballSize - 24);
        else if (side === 'center') x = r.left + r.width / 2 - ballSize / 2;
        else x = Math.min(vw - ballSize - 16, r.right + 24);
        // Scroll position at which the ball is AT this stop: when the anchor
        // sits at 55% of the viewport (clamped at both ends of the document).
        var atScroll = Math.max(0, Math.min(docH, docTop - vh * 0.55));
        // The anchor's position IN THE VIEWPORT at that scroll — not its
        // position now. Measuring at load put every lower anchor thousands of
        // pixels down, so every floor fell outside the viewport and the ball
        // spent the whole page pinned to the bottom clamp.
        var viewTop = docTop - atScroll;
        return {
          scroll: atScroll,
          x: x,
          // Narrow: ride the gap under the block. Wide: through its middle,
          // where passing behind a card is the intended depth cue.
          y: narrow
            ? viewTop + r.height + 18
            : viewTop + r.height / 2 - ballSize / 2,
          scale: scale
        };
      }).sort(function (a, b) { return a.scroll - b.scroll; });
      // Signed path length up to each stop — the spin integrator.
      var run = 0;
      for (var i = 0; i < stops.length; i++) {
        stops[i].path = run;
        if (i < stops.length - 1) run += stops[i + 1].x - stops[i].x;
      }
    }

    function place(s) {
      if (!stops.length) return;
      if (typeof s !== 'number') s = window.scrollY;
      var i = 0;
      while (i < stops.length - 1 && s > stops[i + 1].scroll) i++;
      var a = stops[i];
      var b = stops[Math.min(i + 1, stops.length - 1)];
      var span = Math.max(1, b.scroll - a.scroll);
      var t = Math.max(0, Math.min(1, (s - a.scroll) / span));

      var x = a.x + (b.x - a.x) * t;
      var floor = a.y + (b.y - a.y) * t;   // the line the ball bounces along
      var sc = (a.scale || 1) + ((b.scale || 1) - (a.scale || 1)) * t;

      // Which bounce are we inside, and how far through it?
      var n = 0;
      while (n < bounces - 1 && t > cum[n + 1]) n++;
      var u = (t - cum[n]) / share[n];

      // Apex decays as e^2n; the parabola is the classic 4u(1-u).
      var apex = vh * (narrow ? SEAM_APEX : APEX) * Math.pow(E, 2 * n) * sc;
      var h = apex * 4 * u * (1 - u);
      var y = floor - h;

      // Impact: a short pulse either side of every floor contact, sized by
      // the speed the ball arrives with (∝ √apex of the bounce it just left).
      // Both the launch at the very top of the page and the final resting
      // frame are exempt — the ball is sitting still there, not landing, and
      // a permanently squashed ball at rest is the tell that it's fake.
      var W = 0.09;
      var edge = Math.min(u, 1 - u) / W;
      var pulse = edge < 1 ? (1 - edge) * (1 - edge) : 0;
      var atLaunch = i === 0 && n === 0 && u < 0.5;
      var atRest = i >= stops.length - 2 && n === bounces - 1 && u > 0.5;
      if (atLaunch || atRest) pulse = 0;
      var hit = Math.sqrt(Math.pow(E, 2 * n));
      var squash = 0.3 * hit * pulse;
      var sy = 1 - squash;
      var sx = 1 / sy;                       // it widens as it flattens

      // Spin: one full turn per circumference travelled, signed by direction.
      var travelled = a.path + (x - a.x);
      var spin = (travelled / (Math.PI * ballSize)) * 360;

      // Clamp against the VISUAL size (scale grows from the box centre).
      var grow = (ballSize * (sc - 1)) / 2;
      x = Math.max(8 + grow, Math.min(vw - ballSize - 8 - grow, x));
      y = Math.max(8 + grow, Math.min(vh - ballSize - 8 - grow, y));

      ball.style.transform =
        'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
      ballCore.style.transform = 'scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')';
      ballImg.style.transform = 'rotate(' + spin.toFixed(1) + 'deg)';

      if (ballShadow) {
        // Height above the floor, 0 (touching) to 1 (apex of the first bounce).
        var lift = Math.min(1, h / Math.max(1, vh * APEX * sc));
        var shSc = (0.55 + 0.45 * sc) * (1 - 0.5 * lift);
        var shX = x + ballSize / 2;
        var shY = Math.min(vh - 10, y + ballSize * (0.5 + 0.5 * sc) - 6);
        ballShadow.style.transform =
          'translate(' + (shX - ballSize / 2).toFixed(1) + 'px,' + shY.toFixed(1) + 'px)' +
          ' scale(' + shSc.toFixed(3) + ',' + (shSc * (1 - 0.35 * lift)).toFixed(3) + ')';
        ballShadow.style.opacity = (0.75 * (1 - 0.72 * lift)).toFixed(3);
      }
    }

    /* Driving the ball straight off scroll events looked fine on a trackpad
       and stuttered badly on a phone: during momentum scrolling iOS delivers
       scroll events in coarse, irregular bursts while it keeps compositing at
       60fps, so a position-fixed element painted only on those events falls
       behind the page and snaps forward. This runs its own frame loop instead
       and eases toward the real scroll position, so every painted frame gets a
       fresh value and the coarse samples are smoothed rather than shown. The
       loop sleeps once the ball has caught up and no scroll has arrived for
       half a second. */
    var smooth = window.scrollY, raf = 0, lastScroll = 0;
    function now() {
      return window.performance && performance.now ? performance.now() : Date.now();
    }
    function tick() {
      var target = window.scrollY;
      smooth += (target - smooth) * 0.2;
      if (Math.abs(target - smooth) < 0.5) smooth = target;
      place(smooth);
      raf = smooth !== target || now() - lastScroll < 500
        ? requestAnimationFrame(tick)
        : 0;
    }
    function onScroll() {
      lastScroll = now();
      if (!raf) raf = requestAnimationFrame(tick);
    }

    measure();
    place(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });

    /* Mobile browsers fire resize every time the URL bar slides away, which
       changes innerHeight mid-scroll. Re-measuring there recomputes every
       stop's scroll position and floor, and the ball teleports. Only a width
       change or a real height jump (rotation) earns a re-measure. */
    var lastW = window.innerWidth, lastH = window.innerHeight;
    window.addEventListener('resize', function () {
      var w = window.innerWidth, h = window.innerHeight;
      if (w === lastW && Math.abs(h - lastH) < 120) return;
      lastW = w; lastH = h;
      measure();
      smooth = window.scrollY;
      place(smooth);
    });
    // Re-measure once assets/fonts settle layout.
    window.addEventListener('load', function () {
      measure();
      smooth = window.scrollY;
      place(smooth);
    });
  }

  /* ============================================================
     BOOKING — the live flow.
     Boots from /api/padel-status. Disabled -> the preview drawer
     (today's behavior, untouched). Enabled -> real date/price/spots
     on the page and a stepped drawer: email (guests) -> five-tap
     quiz (first-timers, the SERVER decides who sees it) -> Stripe
     embedded checkout -> confirmed. The Stripe client machinery
     (ensureStripe re-injection, in-app-browser detection, POST ->
     initEmbeddedCheckout -> GET verify paid) mirrors lfg-track.js.
     ?pdpreview=1 forces the enabled UI with mock data so the whole
     drawer can be exercised without touching prod config.
     ============================================================ */
  function el(id) { return document.getElementById(id); }
  function param(n) { try { return new URL(window.location.href).searchParams.get(n); } catch (e) { return null; } }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var WA = 'https://wa.me/971504264410?text=';

  // In-app browsers (Instagram / Facebook / TikTok / Snapchat webviews) frequently block
  // js.stripe.com, so window.Stripe never appears and checkout dead-ends. Detect that case
  // so we can tell the player to open the link in a real browser instead of showing a
  // generic "payment library not loaded" error. (Same machinery as lfg-track.js.)
  function isInAppBrowser() {
    var ua = navigator.userAgent || '';
    return /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|musical_ly|Snapchat/i.test(ua);
  }
  // Return the Stripe global, re-injecting the script on demand if the original tag was
  // blocked at parse time. Resolves null if it still can't load within the timeout.
  function ensureStripe(timeoutMs) {
    return new Promise(function (resolve) {
      if (window.Stripe) return resolve(window.Stripe);
      var deadline = Date.now() + (timeoutMs || 6000);
      if (!document.getElementById('stripe-js-reload')) {
        var s = document.createElement('script');
        s.id = 'stripe-js-reload';
        s.src = 'https://js.stripe.com/v3/';
        s.async = true;
        document.head.appendChild(s);
      }
      (function poll() {
        if (window.Stripe) return resolve(window.Stripe);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(poll, 150);
      })();
    });
  }

  var STATUS = null;        // /api/padel-status payload once enabled
  var NIGHT = null;         // { day: 'Monday 10 Aug', time: '8:30 PM', weekday: 'Monday', time24: '20:30' }
  var live = false;
  var PREVIEW_PAY = false;  // ?pdpreview=1 -> mock the pay API too
  var session = null;       // Supabase session when a member is logged in
  var sessionReady = null;  // one shared settle promise (PWA cold start is slow)

  // Resolves the logged-in member once, and caches it. getSettledSession
  // retries for ~5s, so anything that routes on login state must await this
  // rather than read `session` and guess.
  function ensureSession() {
    if (session) return Promise.resolve(session);
    if (!sessionReady) {
      sessionReady = (window.lfg && window.lfg.getSettledSession)
        ? window.lfg.getSettledSession()
            .then(function (s) { session = s || null; return session; })
            .catch(function () { return null; })
        : Promise.resolve(null);
    }
    return sessionReady;
  }

  function nightParts(iso) {
    var d = new Date(iso);
    return {
      day: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' }),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' }),
      weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dubai' }),
      // 24h Dubai clock for schema.org, which wants "20:30", not "8:30 PM".
      time24: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' })
    };
  }

  /* ---------- persistence: email + quiz answers survive refresh/Back ---------- */
  var store = {
    load: function () { try { return JSON.parse(localStorage.getItem('pd_book') || '{}') || {}; } catch (e) { return {}; } },
    save: function (s) { try { localStorage.setItem('pd_book', JSON.stringify(s)); } catch (e) {} },
    clear: function () { try { localStorage.removeItem('pd_book'); } catch (e) {} }
  };
  var book = store.load();
  if (!book.answers || typeof book.answers !== 'object') book.answers = {};

  /* ---------- the five-tap quiz (values are the server's exact enum) ---------- */
  var QUIZ = [
    { key: 'played', q: 'Played padel before?', a: [['never', 'Never'], ['few', 'A few times'], ['regular', 'Regularly'], ['competitive', 'Competitively']] },
    { key: 'racket', q: 'Other racket sports — tennis, squash, badminton?', a: [['none', 'None'], ['casual', 'Played casually'], ['serious', 'Played seriously']] },
    { key: 'frequency', q: 'How often do you play these days?', a: [['first', 'First time'], ['sometimes', 'Now and then'], ['weekly', 'Weekly'], ['most-days', 'Most days']] },
    { key: 'court', q: 'On court, you can…', a: [['learning', 'Still learning the rules'], ['rally', 'Keep a rally going'], ['attack', 'Volley and smash'], ['control', 'Run the match']] },
    { key: 'self', q: 'The word that fits', a: [['beginner', 'Beginner'], ['improver', 'Improver'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']] }
  ];
  // Buying a spot for someone without an LFG account. Non-null for the whole
  // friend purchase, and the quiz writes into IT rather than into `book`, so a
  // friend's answers can never overwrite the buyer's own level. Deliberately
  // not persisted to localStorage: a half-finished friend is not something to
  // restore days later, and the buyer's own booking state is what `book` is for.
  var guest = null;
  var lastGuestName = null;   // who the finished purchase was for, for the success copy
  function answerBag() { return guest ? guest.answers : book.answers; }
  function answersComplete() {
    var bag = answerBag();
    for (var i = 0; i < QUIZ.length; i++) if (!bag[QUIZ[i].key]) return false;
    return true;
  }

  /* ---------- boot from /api/padel-status ---------- */
  function mockStatus() {
    // Mirrors the real config: Monday 20:30 Dubai at Padel AE (Ahmed's format).
    var now = new Date();
    var t = new Date(now.getTime());
    while (t.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dubai' }) !== 'Monday' || t <= now) {
      t = new Date(t.getTime() + 86400000);
    }
    var ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(t);
    var iso = new Date(ymd + 'T20:30:00+04:00').toISOString();
    return {
      enabled: true, event_iso: iso,
      event_date: ymd,
      location: 'Padel AE, Al Quoz', price_aed: 99, capacity: 16,
      paid_count: 7, spots_left: 9, map_url: null, tagline: null,
      duration_min: 120, duration_label: '2 hours'
    };
  }
  // The padel table. Its own points, not the portal's: the ×100 conversion
  // into LFG member points happens server-side in lfg_leaderboard. Stays
  // hidden until somebody has actually scored, so week one shows the format
  // rather than an empty podium.
  function loadBoard() {
    var sec = el('board'), list = el('pdBoardList');
    if (!sec || !list) return;
    fetch('/api/padel-leaderboard')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.players || !d.players.length) return;
        list.innerHTML = d.players.map(function (p) {
          return '<li class="pd-board-row"' + (p.rank <= 3 ? ' data-podium' : '') + '>' +
            '<span class="pd-board-rank">' + p.rank + '</span>' +
            '<span class="pd-board-name">' + escapeHtml(p.name) +
              '<small class="pd-board-nights">' + p.nights + (p.nights === 1 ? ' night' : ' nights') + '</small>' +
            '</span>' +
            '<span class="pd-board-pts">' + p.points + '<small>points</small></span>' +
          '</li>';
        }).join('');
        var note = el('pdBoardNote');
        if (note && d.total_players > d.players.length) {
          note.textContent = d.total_players + ' players have taken a court so far.';
        }
        sec.hidden = false;
      })
      .catch(function () { /* board stays hidden */ });
  }
  loadBoard();

  if (param('pdpreview') === '1') {
    PREVIEW_PAY = true;
    goLive(mockStatus());
  } else {
    fetch('/api/padel-status')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.enabled) goLive(d); })
      .catch(function () { /* preview state stays */ });
  }

  function goLive(d) {
    STATUS = d;
    NIGHT = nightParts(d.event_iso);
    live = true;
    var soldOut = !(d.spots_left > 0);

    // Booking strip: the real night in words, real price, real spots.
    if (dateEl) dateEl.textContent = NIGHT.day + ' · ' + NIGHT.time;
    var priceEl = document.querySelector('.pd-price');
    if (priceEl && priceEl.firstChild) priceEl.firstChild.nodeValue = String(d.price_aed);
    var spotsEl = document.querySelector('.pd-spots');
    if (spotsEl) spotsEl.textContent = soldOut ? 'Sold out for this night' : d.spots_left + ' of ' + d.capacity + ' spots left';
    var startEl = el('pdStartTime'); if (startEl) startEl.textContent = NIGHT.time;
    var capEl = el('pdCapChip'); if (capEl) capEl.textContent = d.capacity + ' per night';
    // Play time is owner-set: some weeks are 90 minutes, and the page used to
    // promise two hours in copy nobody could change without a deploy.
    if (d.duration_label) {
      var ptEl = el('pdPlayTime'); if (ptEl) ptEl.textContent = d.duration_label;
      var ptCopy = el('pdPlayTimeCopy');
      // Sentence-leading, so "90 minutes on proper padel courts" reads right.
      if (ptCopy) ptCopy.textContent = d.duration_label.charAt(0).toUpperCase() + d.duration_label.slice(1);
    }
    if (d.tagline) {
      var tl = document.querySelector('.pd-book-date small');
      if (tl) tl.textContent = d.tagline;
    }

    // Hero meta chips: weekday + time, and a location that taps through to the map.
    var whenEl = el('pdMetaWhen'); if (whenEl) whenEl.textContent = NIGHT.weekday + 's · ' + NIGHT.time;
    var whereEl = el('pdMetaWhere');
    if (whereEl && d.location) {
      var mapHref = d.map_url || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(d.location));
      whereEl.innerHTML = '<a href="' + escapeHtml(mapHref) + '" target="_blank" rel="noopener">' + escapeHtml(d.location) + '</a>';
    }

    // Every surface that names the weekday follows the configured night, so
    // moving the event day in admin never leaves a stale "Monday" behind.
    var dayWord = NIGHT.weekday;
    var heroDay = el('pdHeroDay'); if (heroDay) heroDay.textContent = dayWord;
    var realH2 = el('pdRealH2'); if (realH2) realH2.textContent = dayWord + ', actually';
    var closeH2 = el('pdCloseH2'); if (closeH2) closeH2.textContent = 'See you ' + dayWord + '.';
    var loginNight = el('pdLoginNight'); if (loginNight) loginNight.textContent = 'This ' + dayWord;
    document.querySelectorAll('.pd-btn[data-book]').forEach(function (b) {
      if (/Book My \w+ Spot/.test(b.textContent)) b.textContent = 'Book My ' + dayWord + ' Spot';
    });

    // Sold out: the strip says so honestly, and WhatsApp becomes the path.
    if (soldOut) {
      var stripBtn = document.querySelector('.pd-book-right .pd-btn');
      if (stripBtn) {
        stripBtn.textContent = 'Sold out for ' + NIGHT.day;
        var waLine = document.createElement('p');
        waLine.className = 'pd-book-walink';
        waLine.innerHTML = '<a href="' + WA + encodeURIComponent("Hey, padel night is sold out, ping me if a spot opens") + '">Message us and we’ll ping you if a spot opens</a>';
        stripBtn.parentNode.appendChild(waLine);
      }
    }

    // JSON-LD: the schema follows the live config, not the placeholder.
    try {
      var sc = el('pdSchema');
      var data = JSON.parse(sc.textContent);
      data.startDate = d.event_iso;
      // The recurring schedule follows the configured night too, otherwise
      // Google keeps advertising the old weekday and start time after Ahmed
      // moves the event.
      if (data.eventSchedule) {
        data.eventSchedule.byDay = 'https://schema.org/' + NIGHT.weekday;
        data.eventSchedule.startTime = NIGHT.time24;
      }
      if (data.location && d.location) data.location.name = d.location;
      if (data.offers) {
        data.offers.price = String(d.price_aed);
        data.offers.availability = soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock';
      }
      sc.textContent = JSON.stringify(data, null, 2);
    } catch (e) { /* schema stays static */ }

    // Members skip the email step: settle the session in the background now
    // so it's ready by the time the drawer opens.
    ensureSession();

    // Coming back from /login (?book=1): reopen the drawer where they left
    // off, so logging in never costs them their place in the flow.
    if (param('book') === '1') {
      history.replaceState(null, '', location.pathname + location.hash);
      ensureSession().then(function () { openDrawer(); });
    }
  }

  /* ---------- drawer shell ---------- */
  var drawer = el('pdDrawer');
  var scrim = el('pdScrim');
  var closeBtn = el('pdDrawerClose');
  var inflight = false;
  var embedded = null, paySession = null;
  var retryMode = 'pay';
  var successMode = 'paid';

  var PANELS = ['pdStepPreview', 'pdStepLogin', 'pdStepGuest', 'pdStepQuiz', 'pdStepPhone', 'pdStepPay', 'pdStepSuccess', 'pdStepSoldout'];
  function showPanel(id) {
    PANELS.forEach(function (p) { var n = el(p); if (n) n.hidden = (p !== id); });
    if (drawer) drawer.classList.toggle('pd-wide', id === 'pdStepPay');
  }
  function showErr(id, msg) { var n = el(id); if (n) { n.textContent = msg; n.hidden = false; } }
  function hideErr(id) { var n = el(id); if (n) { n.hidden = true; n.textContent = ''; } }
  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.setAttribute('data-label', btn.textContent);
      btn.disabled = true;
      btn.textContent = 'One second…';
    } else {
      btn.disabled = false;
      btn.textContent = btn.getAttribute('data-label') || btn.textContent;
    }
  }
  function destroyEmbedded() { try { if (embedded) embedded.destroy(); } catch (e) {} embedded = null; }

  /* ---------- step stack + history: browser Back walks the drawer ---------- */
  var stack = [];             // e.g. ['login', 'quiz:0', 'quiz:1', 'pay']
  var closingViaUi = false;   // suppress the popstate our own history.go() fires

  function topStep() { return stack.length ? stack[stack.length - 1] : null; }
  function render(step) {
    if (step === 'login') renderLogin();
    else if (step === 'guest') renderGuest();
    else if (step && step.indexOf('quiz:') === 0) renderQuiz(parseInt(step.slice(5), 10));
    else if (step === 'phone') renderPhone();
    else if (step === 'pay') renderPay();
    else if (step === 'success') renderSuccess();
    else if (step === 'soldout') renderSoldout();
  }
  function pushStep(step) {
    stack.push(step);
    try { history.pushState({ pdStep: stack.length }, ''); } catch (e) {}
    render(step);
  }
  function replaceStep(step) {
    stack[stack.length - 1] = step;
    render(step);
  }
  window.addEventListener('popstate', function (e) {
    var depth = (e.state && e.state.pdStep) || 0;
    if (closingViaUi) { if (depth === 0) closingViaUi = false; return; }
    if (!drawer || !drawer.classList.contains('open')) { stack = []; return; }
    while (stack.length > depth) stack.pop();
    if (!stack.length) { hideDrawer(); return; }
    render(topStep());
  });

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('open');
    scrim.classList.add('open');
    if (closeBtn) closeBtn.focus();
    stack = [];
    if (!live || !STATUS) { showPanel('pdStepPreview'); return; }
    if (!(STATUS.spots_left > 0)) { pushStep('soldout'); return; }
    if (session) {
      // Logged-in member: no email step, straight to checkout (Bearer).
      pushStep('pay');
      startPay({ authed: true });
      return;
    }
    // The session may still be settling (PWA/iOS cold start takes seconds).
    // Show the login step now so the drawer never sits blank, then upgrade to
    // checkout if a session lands while they are still on it — a logged-in
    // member should never be asked to log in again.
    pushStep('login');
    ensureSession().then(function (s) {
      if (!s || topStep() !== 'login') return;
      replaceStep('pay');
      startPay({ authed: true });
    });
  }
  function hideDrawer() { // visual close only (popstate already ate the history)
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    destroyEmbedded();
  }
  function closeDrawer() { // UI-initiated (Esc / scrim / X): unwind our entries too
    if (!drawer || !drawer.classList.contains('open')) return;
    var depth = stack.length;
    stack = [];
    hideDrawer();
    if (depth > 0) {
      closingViaUi = true;
      try { history.go(-depth); } catch (e) { closingViaUi = false; }
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-book]'), function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openDrawer();
    });
  });
  if (scrim) scrim.addEventListener('click', closeDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  /* ---------- step: login (booking requires an account) ----------
     Guest checkout is deliberately gone: a padel spot carries a level, a
     points history and a place in the court rotation, so it has to hang off
     a real account rather than a typed-in email. The login round-trip
     returns to ?book=1, which reopens this drawer straight on checkout. */
  function renderLogin() {
    showPanel('pdStepLogin');
    var nightEl = el('pdLoginNight');
    if (nightEl && NIGHT) nightEl.textContent = NIGHT.day + ' · ' + NIGHT.time;
  }

  /* ---------- step: quiz (first-timers, server-gated) ---------- */
  function toQuiz() {
    var idx = 0;
    var bag = answerBag();
    while (idx < QUIZ.length && bag[QUIZ[idx].key]) idx++;
    if (idx >= QUIZ.length) idx = QUIZ.length - 1;
    // Member path opened straight onto 'pay'; the quiz replaces it so Back
    // from question one closes the drawer instead of landing on an empty
    // pay screen. Guests push, so Back returns to the email step.
    if (topStep() === 'pay') replaceStep('quiz:' + idx);
    else pushStep('quiz:' + idx);
  }
  /* ---------- step: phone (asked once, only when we have no number) ----------
     Server-gated exactly like the quiz: /api/padel-pay answers needs_phone and
     this renders, so a player who already gave a number on the run form or as a
     coaching client is never asked again. */
  var phoneGiven = null;

  // UAE default, copied from the run check-in so both forms store the same
  // shape: a local 05X becomes +9715X, anything already international is left
  // alone.
  function toE164(v) {
    var s = String(v || '').trim();
    // An international number keeps its country code but loses its spacing:
    // "+44 7700 900123" has to reach the server as +447700900123 or the
    // server-side check rejects it and the player cannot book at all.
    if (s.charAt(0) === '+') return '+' + s.slice(1).replace(/[^\d]/g, '');
    var d = s.replace(/[^\d]/g, '').replace(/^0+/, '');
    if (!d) return '';
    if (d.indexOf('971') === 0) return '+' + d;
    return '+971' + d;
  }

  function toPhone() {
    if (topStep() === 'pay') replaceStep('phone');
    else pushStep('phone');
  }

  function renderPhone() {
    showPanel('pdStepPhone');
    hideErr('pdPhoneErr');
    var input = el('pdPhoneInput');
    if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  }

  var phoneNext = el('pdPhoneNext');
  if (phoneNext) phoneNext.addEventListener('click', function () {
    if (inflight) return;
    var input = el('pdPhoneInput');
    var e164 = toE164(input && input.value);
    if (!/^\+\d{8,16}$/.test(e164)) {
      showErr('pdPhoneErr', 'Enter a mobile number we can reach you on, like 050 123 4567.');
      return;
    }
    hideErr('pdPhoneErr');
    phoneGiven = e164;
    pushStep('pay');
    startPay({ authed: true, btn: phoneNext });
  });
  var phoneInput = el('pdPhoneInput');
  if (phoneInput) phoneInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (phoneNext) phoneNext.click(); }
  });

  /* ---------- step: bring a friend ---------- */
  function renderGuest() {
    showPanel('pdStepGuest');
    hideErr('pdGuestErr');
    var n = el('pdGuestName');
    if (n) { n.value = (guest && guest.name) || ''; n.focus(); }
    var e = el('pdGuestEmail');
    if (e) e.value = (guest && guest.email) || '';
  }
  var guestNext = el('pdGuestNext');
  if (guestNext) guestNext.addEventListener('click', function () {
    var name = (el('pdGuestName').value || '').trim().replace(/\s+/g, ' ');
    if (!name) { showErr('pdGuestErr', "Type your friend's name so we know who is on court."); return; }
    var email = (el('pdGuestEmail').value || '').trim();
    if (email && email.indexOf('@') < 1) { showErr('pdGuestErr', 'That email does not look right. Leave it blank if you are not sure.'); return; }
    hideErr('pdGuestErr');
    // Fresh answers every time: the quiz describes THIS friend.
    guest = { name: name, email: email, answers: {} };
    pushStep('quiz:0');
  });

  function renderQuiz(i) {
    if (!(i >= 0 && i < QUIZ.length)) i = 0;
    showPanel('pdStepQuiz');
    var q = QUIZ[i];
    var bag = answerBag();
    el('pdQuizProgress').textContent = (i + 1) + ' of 5';
    el('pdQuizIntro').hidden = i !== 0;
    if (i === 0) {
      el('pdQuizIntro').textContent = guest
        ? 'Five taps about ' + guest.name + ', so they get matched with people who play like them.'
        : 'First time with us. Five taps, and you get matched with people who play like you.';
    }
    // The questions are written in the second person for the player answering
    // about themselves. Buying for someone else, they are about a third party,
    // so the two that read wrong get re-pointed rather than left saying "you".
    var GUEST_Q = {
      played: 'Have they played padel before?',
      racket: 'Other racket sports — tennis, squash, badminton?',
      frequency: 'How often do they play these days?',
      court: 'On court, they can…',
      self: 'The word that fits them'
    };
    el('pdQuizQ').textContent = guest ? (GUEST_Q[q.key] || q.q) : q.q;
    var wrap = el('pdQuizChips');
    wrap.innerHTML = '';
    q.a.forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pd-qchip' + (bag[q.key] === pair[0] ? ' sel' : '');
      b.textContent = pair[1];
      b.addEventListener('click', function () { pickAnswer(i, pair[0]); });
      wrap.appendChild(b);
    });
  }
  var quizBack = el('pdQuizBack');
  if (quizBack) quizBack.addEventListener('click', function () { history.back(); });
  function pickAnswer(i, val) {
    if (inflight) return;
    answerBag()[QUIZ[i].key] = val;
    // Only the buyer's own answers are worth surviving a refresh; a friend's
    // live in memory for the length of the purchase.
    if (!guest) store.save(book);
    if (i < QUIZ.length - 1) {
      pushStep('quiz:' + (i + 1));
    } else {
      pushStep('pay');
      startPay({ authed: true });
    }
  }

  /* ---------- step: pay ---------- */
  function paySummaryText() {
    return NIGHT.day + ' · ' + NIGHT.time + ' · ' + STATUS.location + ' · AED ' + STATUS.price_aed;
  }
  function renderPayBase() {
    showPanel('pdStepPay');
    el('pdPaySummary').textContent = paySummaryText();
    hideErr('pdPayErr');
    el('pdPayWa').hidden = true;
  }
  function renderPay() {
    renderPayBase();
    var retry = el('pdPayRetry');
    if (embedded) { retry.hidden = true; return; } // checkout still mounted
    if (inflight) {
      el('pdPayMount').innerHTML = '<p class="pd-payload pd-payload-busy">Loading secure checkout…</p>';
      retry.hidden = true;
    } else {
      // Reached by Back-navigation with nothing mounted: restart the checkout
      // by itself instead of parking the player behind a manual button.
      el('pdPayMount').innerHTML = '<p class="pd-payload pd-payload-busy">Loading secure checkout…</p>';
      retry.hidden = true;
      startPay({ authed: true });
    }
  }
  function renderPayError(msg) {
    if (topStep() !== 'pay') pushStep('pay');
    showPanel('pdStepPay');
    el('pdPaySummary').textContent = paySummaryText();
    showErr('pdPayErr', msg);
    el('pdPayMount').innerHTML = '';
    var retry = el('pdPayRetry');
    retry.hidden = false;
    retry.textContent = 'Try again';
    retryMode = 'pay';
    el('pdPayWa').hidden = false;
    var wa = el('pdPayWaLink');
    if (wa) wa.href = WA + encodeURIComponent("Hey, I'm trying to book padel night and the payment won't go through");
  }
  var payRetry = el('pdPayRetry');
  if (payRetry) payRetry.addEventListener('click', function () {
    if (inflight) return;
    if (retryMode === 'verify') { verifyPaid(); return; }
    hideErr('pdPayErr');
    el('pdPayMount').innerHTML = '<p class="pd-payload pd-payload-busy">Loading secure checkout…</p>';
    startPay({ authed: true, btn: payRetry });
  });

  // Errors land above the CTA of whichever step the player is on; input is
  // preserved and retry stays available either way.
  function stepError(msg) {
    renderPayError(msg);
  }

  /* ---------- the pay API (mirrors lfg-track.js startCheckout) ---------- */
  function padelPay(body) {
    if (PREVIEW_PAY) return mockPay(body);
    // Members only: the request always rides the Bearer token. A signed-out
    // caller gets a 401 from the server and the drawer routes to login.
    if (window.lfg && window.lfg.api) {
      var payload = {};
      if (body.answers) payload.answers = body.answers;
      if (body.guest) payload.guest = body.guest;
      if (body.phone) payload.phone = body.phone;
      return window.lfg.api('/api/padel-pay', { method: 'POST', body: JSON.stringify(payload) })
        .then(function (r) { return { status: r.status, data: r.data }; });
    }
    return fetch('/api/padel-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: body.answers || undefined, guest: body.guest || undefined, phone: body.phone || undefined })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }
  // ?pdpreview=1: no server config exists locally, so the pay API is mocked —
  // first attempt runs the quiz, then the pay step shows a preview notice
  // where Stripe would mount. Every screen is reachable; no charge possible.
  var mockProfile = false;
  function mockPay(body) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (!body.answers && !mockProfile) return resolve({ status: 200, data: { needs_questionnaire: true } });
        mockProfile = true;
        resolve({ status: 200, data: { preview: true } });
      }, 400);
    });
  }

  async function startPay(opts) {
    if (inflight) return;
    inflight = true;
    if (opts.btn) setBusy(opts.btn, true);
    try {
      var out;
      try {
        out = await padelPay({
          authed: !!opts.authed,
          email: opts.email,
          answers: answersComplete() ? answerBag() : undefined,
          guest: guest ? { name: guest.name, email: guest.email || undefined } : undefined,
          phone: phoneGiven || undefined
        });
      } catch (e) {
        stepError('Network error starting the booking. Check your connection and try again.');
        return;
      }
      var status = out.status, data = out.data || {};

      // Session expired between opening the drawer and paying: send them to
      // log in rather than showing a dead error, and bring them back here.
      if (status === 401 || data.login_required) {
        session = null;
        sessionReady = null;
        if (topStep() === 'pay') replaceStep('login'); else pushStep('login');
        return;
      }
      if (status === 409 && data.sold_out) {
        var spotsEl = document.querySelector('.pd-spots');
        if (spotsEl) spotsEl.textContent = 'Sold out for this night';
        pushStep('soldout');
        return;
      }
      if (status === 409 && data.already_paid) { showSuccessStep('already'); return; }
      if (data.needs_questionnaire) { toQuiz(); return; }
      if (data.needs_phone) { toPhone(); return; }
      if (data.preview) { showPreviewPay(); return; }
      if (!data.client_secret || !data.publishable_key) {
        stepError((data && data.error) || 'Could not start payment. Try again or message us on WhatsApp.');
        return;
      }

      var StripeLib = window.Stripe || await ensureStripe(6000);
      if (!StripeLib) {
        stepError(isInAppBrowser()
          ? "Card payments are blocked inside the Instagram/in-app browser. Tap the ••• menu (top right) and choose “Open in Safari” or “Open in Chrome”, then pay from there."
          : "The payment library was blocked, usually by an ad or privacy blocker. Turn it off for this page, or open the link in a different browser, then try again."
        );
        return;
      }

      if (topStep() !== 'pay') pushStep('pay');
      renderPayBase();
      el('pdPayMount').innerHTML = '<p class="pd-payload pd-payload-busy">Loading secure checkout…</p>';
      el('pdPayRetry').hidden = true;
      try {
        destroyEmbedded();
        var stripe = StripeLib(data.publishable_key);
        paySession = data.id;
        embedded = await stripe.initEmbeddedCheckout({
          clientSecret: data.client_secret,
          onComplete: verifyPaid
        });
        el('pdPayMount').innerHTML = '';
        embedded.mount('#pdPayMount');
      } catch (e) {
        renderPayError('Could not load checkout. Try again.');
      }
    } finally {
      inflight = false;
      if (opts.btn) setBusy(opts.btn, false);
    }
  }

  function showPreviewPay() {
    if (topStep() !== 'pay') pushStep('pay');
    renderPayBase();
    el('pdPayRetry').hidden = true;
    el('pdPayMount').innerHTML =
      '<p class="pd-payload">Preview mode: live checkout is switched off here. On the real page the secure card form loads in this space.</p>';
  }

  // Only a verified paid session shows success — onComplete alone is not proof.
  async function verifyPaid() {
    try {
      var r = await fetch('/api/padel-pay?session_id=' + encodeURIComponent(paySession));
      var d = await r.json();
      if (d && d.payment_status === 'paid') {
        destroyEmbedded();
        showSuccessStep('paid');
        return;
      }
    } catch (e) { /* fall through to the recheck state */ }
    renderPayError("We couldn't confirm the payment yet. Give it a moment and tap Check again — if you were charged, your spot is safe.");
    var retry = el('pdPayRetry');
    retry.textContent = 'Check again';
    retryMode = 'verify';
  }

  /* ---------- steps: success + sold out ---------- */
  function showSuccessStep(mode) {
    successMode = mode;
    lastGuestName = guest ? guest.name : null;
    guest = null;               // the purchase is over, whichever way it ended
    book = { answers: {} };
    store.clear();
    pushStep('success');
  }
  function renderSuccess() {
    showPanel('pdStepSuccess');
    var already = successMode === 'already';
    var friend = lastGuestName;
    el('pdSuccessTitle').textContent = friend
      ? (already ? friend + ' is already in.' : friend + ' is in for ' + NIGHT.day + '.')
      : (already ? "You're already in for " + NIGHT.day + '.' : "You're in for " + NIGHT.day + '.');
    el('pdSuccessWhere').textContent = NIGHT.time + ' · ' + STATUS.location;
    el('pdSuccessEmailLine').hidden = already;
    if (friend && !already) {
      el('pdSuccessEmailLine').textContent = 'The confirmation is in your inbox. Tell ' + friend + ' where to be.';
    }
    // Only a signed-in member on a live night can buy for someone else, and the
    // server requires their own spot to be paid first. A sold-out night still
    // routes to the sold-out panel from the pay call, which is the honest answer.
    var bf = el('pdBringFriend');
    if (bf) bf.hidden = !(live && session);
    el('pdSuccessWa').href = WA + encodeURIComponent("Hey, I'm booked for padel night, quick question");
  }
  var bringFriendBtn = el('pdBringFriend');
  if (bringFriendBtn) bringFriendBtn.addEventListener('click', function () {
    guest = null;
    pushStep('guest');
  });
  // A sold-out night is the moment demand is highest, so it ends in an action
  // rather than an apology. The list is real: drops happen most weeks before the
  // 2pm cutoff, and it decides who gets called first.
  // Same auth path the pay call uses: window.lfg.api attaches the bearer token
  // when the shared client is present, plain fetch otherwise (server 401s and
  // the drawer routes to login, which is the correct signed-out behaviour).
  function authedJson(url, body, method) {
    var verb = method || 'POST';
    var opts = { method: verb };
    if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    if (window.lfg && window.lfg.api) {
      return window.lfg.api(url, opts).then(function (r) {
        return { ok: r.status >= 200 && r.status < 300, status: r.status, data: r.data };
      });
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  var waitBusy = false;
  function waitState(msg, onList) {
    var s = el('pdWaitState'), b = el('pdWaitBtn');
    if (s) { s.textContent = msg || ''; s.hidden = !msg; }
    if (b) {
      b.disabled = waitBusy;
      b.textContent = waitBusy ? 'Saving…' : onList ? 'Leave the waiting list' : 'Join the waiting list';
      b.classList.toggle('pd-btn-quiet', !!onList);
    }
  }
  async function waitToggle(leaving) {
    if (waitBusy) return;
    waitBusy = true; waitState('', leaving);
    try {
      var r = await authedJson('/api/padel-waitlist', { action: leaving ? 'leave' : 'join' });
      waitBusy = false;
      var d = r.data || {};
      if (r.status === 401 || d.login_required) { pushStep('login'); return; }
      if (d.spot_open) { waitState('A spot just opened. Close this and book it.', false); return; }
      if (d.already_in) { waitState("You're already in for this night.", false); return; }
      if (!r.ok) { waitState(d.error || 'That did not save. Try again.', leaving); return; }
      if (d.on_list) waitState('You are number ' + d.position + ' on the list. We call the list first.', true);
      else waitState('Off the list. You can rejoin any time.', false);
    } catch (e) {
      waitBusy = false;
      waitState('That did not save. Try again.', leaving);
    }
  }
  function renderSoldout() {
    showPanel('pdStepSoldout');
    el('pdSoldoutBody').textContent = 'All ' + STATUS.capacity + ' spots for ' + NIGHT.day + ' are taken.';
    el('pdSoldoutWa').href = WA + encodeURIComponent("Hey, padel night is sold out, ping me if a spot opens");
    var b = el('pdWaitBtn');
    if (b && !b._wired) {
      b._wired = true;
      b.addEventListener('click', function () { waitToggle(b.textContent.indexOf('Leave') === 0); });
    }
    waitState('', false);
    // Signed-out players see the plain invitation; signed-in ones see where they
    // already stand, so the button never lies about their position.
    if (session) {
      authedJson('/api/padel-waitlist', null, 'GET').then(function (r) {
        var d = (r && r.data) || {};
        if (d.on_list) waitState('You are number ' + d.position + ' on the list. We call the list first.', true);
      }).catch(function () {});
    }
  }
})();

// Real-footage band (#real): honor reduced motion (poster only, no autoplay)
// and pause playback off-screen so the loop never burns battery unseen.
(function () {
  var v = document.querySelector('.pd-real-video');
  if (!v) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    v.removeAttribute('autoplay');
    v.pause();
    return;
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { v.play().catch(function () {}); }
        else { v.pause(); }
      });
    }, { threshold: 0.15 }).observe(v);
  }
})();
