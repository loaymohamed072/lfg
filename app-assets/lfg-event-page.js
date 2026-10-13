/* LFG events page: reads the slug from the URL, renders the event, takes a free
   RSVP or a paid booking (Stripe embedded) with no account. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('ev-js');
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var WA = 'https://wa.me/971506767364?text=';
  var slug = window.__evSlug || (location.pathname.match(/\/events\/([a-z0-9-]+)/i) || [])[1] || new URLSearchParams(location.search).get('slug') || '';
  var EV = null, paySession = null, embedded = null, inflight = false;

  function dubai(iso, opts) {
    try { return new Date(iso).toLocaleString('en-GB', Object.assign({ timeZone: 'Asia/Dubai' }, opts)); } catch (e) { return iso; }
  }
  function whenLine(ev) {
    var day = dubai(ev.starts_at, { weekday: 'long', day: 'numeric', month: 'long' });
    var start = dubai(ev.starts_at, { hour: 'numeric', minute: '2-digit' });
    var end = ev.ends_at ? dubai(ev.ends_at, { hour: 'numeric', minute: '2-digit' }) : '';
    return day + ' · ' + start + (end ? ' to ' + end : '');
  }
  function reveal() {
    var items = document.querySelectorAll('.ev-reveal');
    if (!('IntersectionObserver' in window)) { items.forEach(function (n) { n.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (n) { io.observe(n); });
  }

  function renderClosed(title, body) {
    el('evHero').hidden = true; el('evBody').hidden = true;
    var c = el('evClosed'); c.hidden = false;
    el('evClosedTitle').textContent = title; el('evClosedBody').textContent = body;
    document.title = title + ' · LFG Dubai';
  }

  function render(ev) {
    EV = ev;
    document.title = ev.title + ' · LFG Dubai';
    var meta = document.querySelector('meta[name="description"]'); if (meta) meta.setAttribute('content', ev.tagline || (ev.title + ' with LFG Dubai.'));
    var og = document.querySelector('meta[property="og:title"]'); if (og) og.setAttribute('content', ev.title + ' · LFG Dubai');
    var ogd = document.querySelector('meta[property="og:description"]'); if (ogd) ogd.setAttribute('content', ev.tagline || whenLine(ev));
    if (ev.cover_url) { var ogi = document.querySelector('meta[property="og:image"]'); if (ogi) ogi.setAttribute('content', ev.cover_url); }
    try {
      el('evSchema').textContent = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Event', name: ev.title, description: ev.tagline || ev.description || '',
        startDate: ev.starts_at, endDate: ev.ends_at || undefined, eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: ev.location ? { '@type': 'Place', name: ev.location } : undefined,
        image: ev.cover_url || 'https://www.lfgdubai.com/og-image.jpg',
        organizer: { '@type': 'Organization', name: 'LFG Dubai', url: 'https://www.lfgdubai.com' },
        offers: { '@type': 'Offer', price: String(ev.price_aed || 0), priceCurrency: 'AED', availability: ev.sold_out ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock', url: location.href.split('#')[0] }
      });
    } catch (e) { /* schema is a bonus */ }

    if (ev.cover_url) {
      var img = el('evCover'); if (!img.getAttribute('src')) { img.src = ev.cover_url; if (ev.cover_small_url) img.srcset = ev.cover_small_url + ' 800w, ' + ev.cover_url + ' 1600w'; } img.alt = ev.title; el('evHeroMedia').hidden = false;
    }
    el('evKicker').textContent = 'LFG · ' + dubai(ev.starts_at, { weekday: 'long', day: 'numeric', month: 'long' });
    el('evTitle').textContent = ev.title;
    var deck = el('evDeck'); deck.textContent = ev.tagline || ''; deck.style.display = ev.tagline ? '' : 'none';
    el('evChipWhen').textContent = dubai(ev.starts_at, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + dubai(ev.starts_at, { hour: 'numeric', minute: '2-digit' });
    var where = el('evChipWhere');
    where.innerHTML = ev.location ? (ev.map_url ? '<a href="' + esc(ev.map_url) + '" target="_blank" rel="noopener">' + esc(ev.location) + '</a>' : esc(ev.location)) : 'Dubai';
    el('evChipPrice').textContent = ev.paid ? 'AED ' + ev.price_aed : 'Free';
    var places = el('evChipPlaces');
    if (ev.capacity != null) { places.textContent = ev.sold_out ? 'Full' : ev.spots_left + ' of ' + ev.capacity + ' left'; el('evChipPlacesWrap').hidden = false; }

    var story = el('evStory');
    var paras = String(ev.description || '').split(/\n{2,}|\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    story.innerHTML = paras.length ? paras.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') : '<p>' + esc(ev.tagline || 'Come train, come hang, bring whoever you like.') + '</p>';
    var details = [
      ['When', esc(whenLine(ev))],
      ['Where', ev.location ? (esc(ev.location) + (ev.map_url ? ' · <a href="' + esc(ev.map_url) + '" target="_blank" rel="noopener">Open in Maps</a>' : '')) : 'Dubai, details on WhatsApp'],
      ['Price', ev.paid ? 'AED ' + esc(String(ev.price_aed)) + ' per person' : 'Free, just sign up'],
      ['Places', ev.capacity != null ? (ev.sold_out ? 'Full' : esc(String(ev.spots_left)) + ' left of ' + esc(String(ev.capacity))) : 'Open']
    ];
    el('evDetails').innerHTML = details.map(function (d) { return '<li><span class="k">' + d[0] + '</span><span class="v">' + d[1] + '</span></li>'; }).join('');

    el('evPlateKicker').textContent = ev.paid ? 'Book your place' : 'Save your place';
    el('evPrice').textContent = ev.paid ? 'AED ' + ev.price_aed : 'Free';
    el('evPer').textContent = ev.paid ? 'per person' : 'sign up, show up';
    var spots = el('evSpots');
    spots.textContent = ev.capacity != null ? (ev.sold_out ? 'Sold out' : ev.spots_left + ' of ' + ev.capacity + ' places left') : '';
    el('evSubmit').textContent = ev.paid ? 'Pay AED ' + ev.price_aed : 'Save my place';
    el('evHeroCta').textContent = ev.paid ? 'Book my place' : 'Save my place';
    el('evFootLine').innerHTML = ev.paid
      ? 'Card payment, receipt and a calendar invite by email. Bringing friends? Pick how many and pay in one go.'
      : 'A confirmation and a calendar invite land in your inbox. Change of plans? Reply to it.';
    if (ev.sold_out) {
      el('evForm').hidden = true;
      var so = el('evSoldout'); so.hidden = false;
      el('evSoldoutWa').href = WA + encodeURIComponent('Hey, ' + ev.title + ' is full, ping me if a place opens');
    }
    reveal();
  }

  function load() {
    if (!slug) { renderClosed('No event here.', 'The link is missing the event name. Ask whoever sent it for the right one.'); return; }
    (window.__ev || fetch('/api/event-status?slug=' + encodeURIComponent(slug)).then(function (r) { return r.json(); }))
      .then(function (d) {
        if (!d || !d.enabled) { renderClosed('This event is not open.', 'Either it has not been announced yet or it is over. Everything coming up is on WhatsApp first.'); return; }
        if (d.past) { renderClosed(d.title + ' has happened.', 'This one is done. The next one goes out on WhatsApp first.'); return; }
        render(d);
      })
      .catch(function () { renderClosed('Could not load the event.', 'Check your connection and reload. If it keeps failing, message us on WhatsApp.'); });
  }

  /* ---------- the form ---------- */
  function showErr(msg) { var e = el('evErr'); e.textContent = msg; e.hidden = false; }
  function hideErr() { el('evErr').hidden = true; }
  function setBusy(b) { var btn = el('evSubmit'); btn.disabled = b; btn.textContent = b ? (EV && EV.paid ? 'Starting payment…' : 'Saving…') : (EV && EV.paid ? 'Pay AED ' + EV.price_aed : 'Save my place'); }
  function payload() {
    return { slug: slug, name: el('evName').value.trim(), email: el('evEmail').value.trim(), phone: el('evPhone').value.trim(), guests: parseInt(el('evGuests').value, 10) || 0 };
  }
  function validate(p) {
    if (!p.name) return 'Your name, so we know who is coming.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) return 'A real email, the confirmation goes there.';
    return null;
  }
  function showDone(mode) {
    var guests = parseInt(el('evGuests').value, 10) || 0;
    el('evForm').hidden = true; destroyEmbedded(); el('evMount').innerHTML = '';
    var d = el('evDone'); d.hidden = false;
    el('evDoneTitle').textContent = mode === 'already' ? 'You were already in.' : (EV.paid ? "You're in." : "You're on the list.");
    el('evDoneBody').textContent = (guests ? 'You and ' + guests + (guests === 1 ? ' friend' : ' friends') + ' are' : 'You are') + ' down for ' + whenLine(EV) + (EV.location ? ' at ' + EV.location : '') + '. The confirmation and a calendar file are in your inbox.';
    el('evDoneWa').href = WA + encodeURIComponent("Hey, I'm signed up for " + EV.title + ', quick question');
  }
  function destroyEmbedded() { if (embedded) { try { embedded.destroy(); } catch (e) {} embedded = null; } }
  function ensureStripe(ms) {
    return new Promise(function (resolve) {
      if (window.Stripe) return resolve(window.Stripe);
      var s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.async = true;
      var done = false; var finish = function () { if (!done) { done = true; resolve(window.Stripe || null); } };
      s.onload = finish; s.onerror = finish; document.head.appendChild(s); setTimeout(finish, ms || 6000);
    });
  }
  async function verifyPaid() {
    try {
      var r = await fetch('/api/event-pay?session_id=' + encodeURIComponent(paySession));
      var d = await r.json();
      if (d && d.payment_status === 'paid') { showDone('paid'); return; }
    } catch (e) { /* fall through */ }
    showErr("We couldn't confirm the payment yet. Give it a moment and tap the button again. If you were charged, your place is safe.");
    var btn = el('evSubmit'); btn.disabled = false; btn.textContent = 'Check again'; btn.dataset.mode = 'verify';
  }
  async function submit(e) {
    e.preventDefault();
    if (inflight || !EV) return;
    var btn = el('evSubmit');
    if (btn.dataset.mode === 'verify') { btn.dataset.mode = ''; verifyPaid(); return; }
    hideErr();
    var p = payload(); var bad = validate(p); if (bad) { showErr(bad); return; }
    inflight = true; setBusy(true);
    try {
      var r, d;
      try {
        r = await fetch(EV.paid ? '/api/event-pay' : '/api/event-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        d = await r.json().catch(function () { return {}; });
      } catch (err) { showErr('Network error. Check your connection and try again, or message us on WhatsApp.'); return; }
      if (r.status === 409 && d.already_paid) { showDone('already'); return; }
      if (r.status === 409 && d.sold_out) { el('evForm').hidden = true; el('evSoldout').hidden = false; el('evSoldoutWa').href = WA + encodeURIComponent('Hey, ' + EV.title + ' is full, ping me if a place opens'); return; }
      if (!r.ok) { showErr(d.error || 'That did not go through. Try again, or message us on WhatsApp.'); return; }
      if (!EV.paid) { showDone('free'); return; }
      if (!d.client_secret || !d.publishable_key) { showErr(d.error || 'Could not start payment. Try again or message us on WhatsApp.'); return; }
      var StripeLib = window.Stripe || await ensureStripe(6000);
      if (!StripeLib) { showErr('The payment library was blocked, usually by an in-app browser or a blocker. Open this page in Safari or Chrome and try again.'); return; }
      el('evMount').innerHTML = '<p class="ev-payload">Loading secure checkout…</p>';
      try {
        destroyEmbedded();
        paySession = d.id;
        embedded = await StripeLib(d.publishable_key).initEmbeddedCheckout({ clientSecret: d.client_secret, onComplete: verifyPaid });
        el('evMount').innerHTML = ''; embedded.mount('#evMount');
        btn.hidden = true;
        el('evMount').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { el('evMount').innerHTML = ''; showErr('Could not load checkout. Try again.'); }
    } finally { inflight = false; setBusy(false); }
  }

  el('evForm').addEventListener('submit', submit);
  var heroCta = el('evHeroCta');
  if (heroCta) heroCta.addEventListener('click', function (e) { e.preventDefault(); el('evPlate').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(function () { try { el('evName').focus(); } catch (err) {} }, 500); });
  load();
})();
