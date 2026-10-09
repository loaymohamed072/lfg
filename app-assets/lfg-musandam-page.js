/* LFG x Musandam — page script. Contract: MUSANDAM-DESIGN.md.
   Three jobs: the reveals and the H1 mask; the signature (the fjord strip pans
   under a pinned ruler as the section scrolls); and the booking drawer, which
   is the padel drawer's state machine with a trip in it (one date, seats for
   friends by name, no quiz). */
(function () {
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(id) { return document.getElementById(id); }
  function param(n) { try { return new URL(window.location.href).searchParams.get(n); } catch (e) { return null; } }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  var WA = 'https://wa.me/971504264410?text=';
  var SLUG = 'musandam';

  /* ---------- reveals ---------- */
  requestAnimationFrame(function () { requestAnimationFrame(function () { document.documentElement.classList.add('ms-ready'); }); });
  var revealables = Array.prototype.slice.call(document.querySelectorAll('.ms-reveal, .ms-tile'));
  if (reduced || !('IntersectionObserver' in window)) {
    revealables.forEach(function (n) { n.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var n = en.target;
        // Siblings that arrive together stagger 90ms apart.
        var kin = Array.prototype.slice.call(n.parentNode.querySelectorAll('.ms-reveal, .ms-tile'));
        var i = Math.max(0, kin.indexOf(n));
        setTimeout(function () { n.classList.add('in'); }, Math.min(i, 5) * 90);
        io.unobserve(n);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealables.forEach(function (n) { io.observe(n); });
  }

  /* ---------- the signature: the strip pans with the section's scroll ---------- */
  (function () {
    var section = el('day'), track = el('msPanTrack'), pan = el('msPan'), stops = el('msStops');
    if (!section || !track || !pan) return;
    var items = stops ? Array.prototype.slice.call(stops.querySelectorAll('li')) : [];
    var nowLine = el('msStopNow');
    function setStop(p) {
      var idx = Math.min(items.length - 1, Math.floor(p * items.length));
      items.forEach(function (li, i) { li.classList.toggle('on', i === idx); });
      // Phones show the active stop's words under the row (the columns are too narrow).
      if (nowLine && items[idx]) { var sp = items[idx].querySelector('span'); nowLine.textContent = sp ? sp.textContent : ''; }
    }
    if (reduced) {
      // Still: the middle photograph, the ruler on its first stop.
      var mid = track.children[1];
      if (mid) { var w = pan.clientWidth; var off = Math.max(0, mid.offsetLeft - (w - mid.offsetWidth) / 2); track.style.transform = 'translate3d(' + (-off) + 'px,0,0)'; }
      return;
    }
    var ticking = false;
    function frame() {
      ticking = false;
      var r = section.getBoundingClientRect();
      var total = section.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      var p = Math.min(1, Math.max(0, -r.top / total));
      var dist = track.scrollWidth - pan.clientWidth;
      track.style.transform = 'translate3d(' + (-p * dist) + 'px,0,0)';
      setStop(p);
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    frame();
  })();

  /* ============================================================
     BOOKING — boots from /api/trip-status. Disabled -> the preview
     drawer. Enabled -> real price/seats on the plate and the stepped
     drawer: login (members) -> who's coming -> phone (once, if we have
     no number) -> Stripe embedded checkout -> confirmed.
     ============================================================ */
  function isInAppBrowser() { return /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|musical_ly|Snapchat/i.test(navigator.userAgent || ''); }
  function ensureStripe(timeoutMs) {
    return new Promise(function (resolve) {
      if (window.Stripe) return resolve(window.Stripe);
      var deadline = Date.now() + (timeoutMs || 6000);
      if (!document.getElementById('stripe-js-reload')) {
        var s = document.createElement('script'); s.id = 'stripe-js-reload'; s.src = 'https://js.stripe.com/v3/'; s.async = true; document.head.appendChild(s);
      }
      (function poll() { if (window.Stripe) return resolve(window.Stripe); if (Date.now() > deadline) return resolve(null); setTimeout(poll, 150); })();
    });
  }

  var STATUS = null, live = false, session = null, sessionReady = null;
  function ensureSession() {
    if (session) return Promise.resolve(session);
    if (!sessionReady) {
      sessionReady = (window.lfg && window.lfg.getSettledSession)
        ? window.lfg.getSettledSession().then(function (s) { session = s || null; return session; }).catch(function () { return null; })
        : Promise.resolve(null);
    }
    return sessionReady;
  }
  function dayLong(ymd) {
    try { return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' }); } catch (e) { return ymd; }
  }
  function dayShort(ymd) {
    try { return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' }); } catch (e) { return ymd; }
  }
  function timeLabel(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hhmm || '06:00'); if (!m) return '6:00 am';
    var h = parseInt(m[1], 10), mm = m[2], ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return h + ':' + mm + ' ' + ap;
  }

  var statusReq = null, statusFailed = false;
  function loadStatus() {
    statusFailed = false;
    statusReq = fetch('/api/trip-status?slug=' + SLUG)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.enabled) goLive(d); else if (!d) statusFailed = true; else notOpen(); return d; })
      .catch(function () { statusFailed = true; notOpen(); return null; });
    return statusReq;
  }
  function notOpen() {
    var spots = el('msSpots'); if (spots) spots.textContent = '';
  }
  function goLive(d) {
    STATUS = d; live = true;
    var soldOut = !(d.spots_left > 0) || d.past;
    var price = el('msPrice'); if (price) price.textContent = 'AED ' + d.price_aed;
    var meta = el('msPlateMeta'); if (meta) meta.textContent = dayShort(d.trip_date) + ' · pick-up ' + timeLabel(d.pickup_time) + ' · ' + d.capacity + ' seats';
    var spots = el('msSpots');
    if (spots) spots.textContent = d.past ? 'This one has sailed' : soldOut ? 'Sold out' : d.spots_left + ' of ' + d.capacity + ' seats left';
    var when = el('msChipWhen'); if (when) when.textContent = dayShort(d.trip_date) + ' · ' + timeLabel(d.pickup_time) + ' pick-up';
    var where = el('msChipWhere'); if (where && d.location) where.textContent = d.location.replace(/, Oman$/, '');
    var lt = el('msLoginTitle'); if (lt) lt.textContent = dayLong(d.trip_date);
    var sw = el('msSuccessWhen'); if (sw) sw.textContent = dayLong(d.trip_date) + ' · pick-up ' + timeLabel(d.pickup_time) + ', Dubai';
    if (soldOut) {
      var cta = el('msBookCta');
      if (cta) {
        cta.textContent = d.past ? 'Next trip on WhatsApp' : 'Sold out';
        var waLine = document.createElement('p'); waLine.className = 'ms-plate-wa';
        waLine.innerHTML = '<a href="' + WA + encodeURIComponent('Hey, the Musandam trip is sold out, ping me if a seat opens') + '">Message us and we ping you if a seat opens</a>';
        cta.parentNode.appendChild(waLine);
      }
    }
    try {
      var sc = el('msSchema'); var data = JSON.parse(sc.textContent);
      data.startDate = d.trip_iso;
      if (data.offers) { data.offers.price = String(d.price_aed); data.offers.availability = soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'; }
      sc.textContent = JSON.stringify(data, null, 2);
    } catch (e) { /* schema stays static */ }
    ensureSession();
    if (param('book') === '1') {
      history.replaceState(null, '', location.pathname + location.hash);
      ensureSession().then(function () { openDrawer(); });
    }
  }
  loadStatus();

  /* ---------- drawer shell + step stack (browser Back walks the drawer) ---------- */
  var drawer = el('msDrawer'), scrim = el('msScrim'), closeBtn = el('msDrawerClose');
  var inflight = false, openToken = 0, embedded = null, paySession = null, retryMode = 'pay', successMode = 'paid';
  var guests = [];          // friend names for this checkout
  var selfIn = false;       // the buyer already holds a seat; this checkout is for friends only
  var phoneGiven = null;
  var PANELS = ['msStepLoading', 'msStepStatusErr', 'msStepPreview', 'msStepLogin', 'msStepGuests', 'msStepPhone', 'msStepPay', 'msStepSuccess', 'msStepSoldout'];
  function showPanel(id) {
    PANELS.forEach(function (p) { var n = el(p); if (n) n.hidden = (p !== id); });
    if (drawer) drawer.classList.toggle('ms-wide', id === 'msStepPay');
  }
  function showErr(id, msg) { var n = el(id); if (n) { n.textContent = msg; n.hidden = false; } }
  function hideErr(id) { var n = el(id); if (n) { n.hidden = true; n.textContent = ''; } }
  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) { btn.setAttribute('data-label', btn.textContent); btn.disabled = true; btn.textContent = 'One second…'; }
    else { btn.disabled = false; btn.textContent = btn.getAttribute('data-label') || btn.textContent; }
  }
  function destroyEmbedded() { try { if (embedded) embedded.destroy(); } catch (e) {} embedded = null; }

  var stack = [], closingViaUi = false;
  function topStep() { return stack.length ? stack[stack.length - 1] : null; }
  function render(step) {
    if (step === 'login') renderLogin();
    else if (step === 'guests') renderGuests();
    else if (step === 'phone') renderPhone();
    else if (step === 'pay') renderPay();
    else if (step === 'success') renderSuccess();
    else if (step === 'soldout') renderSoldout();
  }
  function pushStep(step) { stack.push(step); try { history.pushState({ msStep: stack.length }, ''); } catch (e) {} render(step); }
  function replaceStep(step) { stack[stack.length - 1] = step; render(step); }
  window.addEventListener('popstate', function (e) {
    var depth = (e.state && e.state.msStep) || 0;
    if (closingViaUi) { if (depth === 0) closingViaUi = false; return; }
    if (!drawer || !drawer.classList.contains('open')) { stack = []; return; }
    while (stack.length > depth) stack.pop();
    if (!stack.length) { hideDrawer(); return; }
    render(topStep());
  });

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('open'); scrim.classList.add('open');
    if (closeBtn) closeBtn.focus();
    stack = []; guests = []; selfIn = false;
    if (!live || !STATUS) {
      if (statusFailed || !statusReq) { showPanel('msStepStatusErr'); return; }
      showPanel('msStepLoading');
      var token = ++openToken;
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve('timeout'); }, 8000); });
      Promise.race([statusReq, timeout]).then(function (r) {
        if (token !== openToken || !drawer.classList.contains('open')) return;
        if (live && STATUS) { openDrawer(); return; }
        if (r === 'timeout') statusFailed = true;
        showPanel(statusFailed ? 'msStepStatusErr' : 'msStepPreview');
      });
      return;
    }
    if (!(STATUS.spots_left > 0) || STATUS.past) { pushStep('soldout'); return; }
    if (session) { pushStep('guests'); return; }
    pushStep('login');
    ensureSession().then(function (s) {
      if (!s || topStep() !== 'login') return;
      replaceStep('guests');
    });
  }
  function hideDrawer() { drawer.classList.remove('open'); scrim.classList.remove('open'); destroyEmbedded(); }
  function closeDrawer() {
    if (!drawer || !drawer.classList.contains('open')) return;
    var depth = stack.length; stack = []; hideDrawer();
    if (depth > 0) { closingViaUi = true; try { history.go(-depth); } catch (e) { closingViaUi = false; } }
  }
  var statusRetry = el('msStatusRetry');
  if (statusRetry) statusRetry.addEventListener('click', function () { loadStatus(); openDrawer(); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-book]'), function (btn) {
    btn.addEventListener('click', function (e) { e.preventDefault(); openDrawer(); });
  });
  if (scrim) scrim.addEventListener('click', closeDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  /* ---------- steps ---------- */
  function renderLogin() { showPanel('msStepLogin'); }

  function renderGuests() {
    showPanel('msStepGuests');
    hideErr('msGuestErr');
    var fields = el('msGuestFields'); if (fields) fields.hidden = guests.length === 0;
    var jm = el('msJustMe'), af = el('msAddFriends'), title = el('msGuestsTitle');
    if (selfIn) {
      if (title) title.textContent = "Who are you bringing?";
      if (jm) jm.hidden = true;
      if (af) af.hidden = true;
      if (fields) fields.hidden = false;
    } else {
      if (title) title.textContent = 'Just you, or friends too?';
      if (jm) jm.hidden = false;
      if (af) af.hidden = false;
    }
  }
  var justMe = el('msJustMe');
  if (justMe) justMe.addEventListener('click', function () { guests = []; pushStep('pay'); startPay({ btn: justMe }); });
  var addFriends = el('msAddFriends');
  if (addFriends) addFriends.addEventListener('click', function () {
    var fields = el('msGuestFields'); if (fields) { fields.hidden = false; var g1 = el('msGuest1'); if (g1) g1.focus(); }
  });
  var guestsNext = el('msGuestsNext');
  if (guestsNext) guestsNext.addEventListener('click', function () {
    if (inflight) return;
    var names = ['msGuest1', 'msGuest2', 'msGuest3'].map(function (id) { var n = el(id); return n ? n.value.trim().replace(/\s+/g, ' ') : ''; }).filter(Boolean);
    if (!names.length) { showErr('msGuestErr', "Enter at least one friend's name, or tap Just me."); return; }
    hideErr('msGuestErr');
    guests = names;
    pushStep('pay');
    startPay({ btn: guestsNext });
  });

  function toE164(v) {
    var s = String(v || '').trim();
    if (s.charAt(0) === '+') return '+' + s.slice(1).replace(/[^\d]/g, '');
    var d = s.replace(/[^\d]/g, '').replace(/^0+/, ''); if (!d) return '';
    if (d.indexOf('971') === 0) return '+' + d;
    return '+971' + d;
  }
  function toPhone() { if (topStep() === 'pay') replaceStep('phone'); else pushStep('phone'); }
  function renderPhone() {
    showPanel('msStepPhone'); hideErr('msPhoneErr');
    var input = el('msPhoneInput'); if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  }
  var phoneNext = el('msPhoneNext');
  if (phoneNext) phoneNext.addEventListener('click', function () {
    if (inflight) return;
    var e164 = toE164(el('msPhoneInput') && el('msPhoneInput').value);
    if (!/^\+\d{8,16}$/.test(e164)) { showErr('msPhoneErr', 'Enter a mobile number we can reach you on, like 050 123 4567.'); return; }
    hideErr('msPhoneErr'); phoneGiven = e164;
    pushStep('pay'); startPay({ btn: phoneNext });
  });
  var phoneInput = el('msPhoneInput');
  if (phoneInput) phoneInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (phoneNext) phoneNext.click(); } });

  function seatCount() { return (selfIn ? 0 : 1) + guests.length; }
  function paySummaryText() {
    var n = seatCount(), price = STATUS.price_aed;
    return dayShort(STATUS.trip_date) + ' · ' + (STATUS.location || 'Khasab') .replace(/, Oman$/, '') + ' · AED ' + price + (n > 1 ? ' × ' + n + ' = AED ' + (price * n) : '');
  }
  function renderPayBase() { showPanel('msStepPay'); el('msPaySummary').textContent = paySummaryText(); hideErr('msPayErr'); el('msPayWa').hidden = true; }
  function renderPay() {
    renderPayBase();
    var retry = el('msPayRetry');
    if (embedded) { retry.hidden = true; return; }
    el('msPayMount').innerHTML = '<p class="ms-payload">Loading secure checkout…</p>';
    retry.hidden = true;
    if (!inflight) startPay({});
  }
  function renderPayError(msg) {
    if (topStep() !== 'pay') pushStep('pay');
    showPanel('msStepPay'); el('msPaySummary').textContent = paySummaryText();
    showErr('msPayErr', msg); el('msPayMount').innerHTML = '';
    var retry = el('msPayRetry'); retry.hidden = false; retry.textContent = 'Try again'; retryMode = 'pay';
    el('msPayWa').hidden = false;
    var wa = el('msPayWaLink'); if (wa) wa.href = WA + encodeURIComponent("Hey, I'm trying to book the Musandam trip and the payment won't go through");
  }
  var payRetry = el('msPayRetry');
  if (payRetry) payRetry.addEventListener('click', function () {
    if (inflight) return;
    if (retryMode === 'verify') { verifyPaid(); return; }
    hideErr('msPayErr'); el('msPayMount').innerHTML = '<p class="ms-payload">Loading secure checkout…</p>';
    startPay({ btn: payRetry });
  });

  function tripPay(body) {
    var payload = { slug: SLUG };
    if (body.guests && body.guests.length) payload.guests = body.guests;
    if (body.phone) payload.phone = body.phone;
    if (window.lfg && window.lfg.api) {
      return window.lfg.api('/api/trip-pay', { method: 'POST', body: JSON.stringify(payload) }).then(function (r) { return { status: r.status, data: r.data }; });
    }
    return fetch('/api/trip-pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) { return res.json().catch(function () { return null; }).then(function (data) { return { status: res.status, data: data }; }); });
  }

  async function startPay(opts) {
    if (inflight) return;
    inflight = true;
    if (opts.btn) setBusy(opts.btn, true);
    try {
      var out;
      try { out = await tripPay({ guests: guests, phone: phoneGiven || undefined }); }
      catch (e) { renderPayError('Network error starting the booking. Check your connection and try again.'); return; }
      var status = out.status, data = out.data || {};
      if (status === 401 || data.login_required) {
        session = null; sessionReady = null;
        if (topStep() === 'pay') replaceStep('login'); else pushStep('login');
        return;
      }
      if (status === 409 && (data.sold_out || data.spots_left != null)) {
        if (data.sold_out) { var spots = el('msSpots'); if (spots) spots.textContent = 'Sold out'; pushStep('soldout'); return; }
        renderPayError(data.error || ('Only ' + data.spots_left + ' seats are left.'));
        return;
      }
      if (status === 409 && data.already_paid) { showSuccessStep('already'); return; }
      if (data.needs_phone) { toPhone(); return; }
      if (!data.client_secret || !data.publishable_key) {
        renderPayError((data && data.error) || 'Could not start payment. Try again or message us on WhatsApp.');
        return;
      }
      var StripeLib = window.Stripe || await ensureStripe(6000);
      if (!StripeLib) {
        renderPayError(isInAppBrowser()
          ? 'Card payments are blocked inside the Instagram/in-app browser. Tap the ••• menu (top right) and choose "Open in Safari" or "Open in Chrome", then pay there.'
          : 'The payment library was blocked, usually by an ad or privacy blocker. Turn it off for this page, or open the link in a different browser, then try again.');
        return;
      }
      if (topStep() !== 'pay') pushStep('pay');
      renderPayBase();
      el('msPayMount').innerHTML = '<p class="ms-payload">Loading secure checkout…</p>';
      el('msPayRetry').hidden = true;
      try {
        destroyEmbedded();
        var stripe = StripeLib(data.publishable_key);
        paySession = data.id;
        embedded = await stripe.initEmbeddedCheckout({ clientSecret: data.client_secret, onComplete: verifyPaid });
        el('msPayMount').innerHTML = '';
        embedded.mount('#msPayMount');
      } catch (e) { renderPayError('Could not load checkout. Try again.'); }
    } finally {
      inflight = false;
      if (opts.btn) setBusy(opts.btn, false);
    }
  }

  // Only a verified paid session shows success; onComplete alone is not proof.
  async function verifyPaid() {
    try {
      var r = await fetch('/api/trip-pay?session_id=' + encodeURIComponent(paySession));
      var d = await r.json();
      if (d && d.payment_status === 'paid') { destroyEmbedded(); showSuccessStep('paid'); return; }
    } catch (e) { /* fall through */ }
    renderPayError("We couldn't confirm the payment yet. Give it a moment and tap Check again. If you were charged, your seat is safe.");
    var retry = el('msPayRetry'); retry.textContent = 'Check again'; retryMode = 'verify';
  }

  var lastGuests = [];
  function showSuccessStep(mode) { successMode = mode; lastGuests = guests.slice(); guests = []; pushStep('success'); }
  function renderSuccess() {
    showPanel('msStepSuccess');
    var already = successMode === 'already';
    var title = el('msSuccessTitle');
    if (title) {
      if (already) title.textContent = "You're already on the dhow.";
      else if (lastGuests.length && selfIn) title.textContent = (lastGuests.length === 1 ? lastGuests[0] + ' is' : lastGuests.length + ' friends are') + ' on the dhow.';
      else if (lastGuests.length) title.textContent = "You're on the dhow, " + (lastGuests.length === 1 ? 'and so is ' + lastGuests[0] : 'and so are ' + lastGuests.length + ' friends') + '.';
      else title.textContent = "You're on the dhow.";
    }
    el('msSuccessEmailLine').hidden = already;
    var bf = el('msBringFriend'); if (bf) bf.hidden = !(live && session);
    el('msSuccessWa').href = WA + encodeURIComponent("Hey, I'm booked for the Musandam trip, quick question");
    // Refresh the seats on the plate behind the drawer.
    loadStatus();
  }
  var bringFriend = el('msBringFriend');
  if (bringFriend) bringFriend.addEventListener('click', function () { selfIn = true; guests = []; pushStep('guests'); });

  function renderSoldout() {
    showPanel('msStepSoldout');
    el('msSoldoutBody').textContent = STATUS.past ? 'This one has sailed. The next trip goes out on WhatsApp first.' : 'All ' + STATUS.capacity + ' seats for ' + dayShort(STATUS.trip_date) + ' are taken.';
    el('msSoldoutWa').href = WA + encodeURIComponent('Hey, the Musandam trip is sold out, ping me if a seat opens');
  }
})();
