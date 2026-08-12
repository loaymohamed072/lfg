// LFG /track paid-run page. Reads event_config for the paid Wednesday run.
// - Logged-in members: skip the form, pay straight from their account (window.lfg session).
// - Guests: capture details via /api/run-register, then pay via /api/run-pay.
// On paid, /api/stripe-webhook (kind:'run') marks the roster.
(function () {
  'use strict';
  var SB_URL = 'https://mqhrjliqjxcxtzorapiy.supabase.co';
  var SB_KEY = 'sb_publishable_WWgNbaLzvfe5PRGUAl5xqQ_aLAcN3d_';

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function el(id) { return document.getElementById(id); }
  function param(n) { try { return new URL(window.location.href).searchParams.get(n); } catch (e) { return null; } }

  function advanceIfPast(dtStr) {
    if (!dtStr) return null;
    var t = new Date(dtStr); if (isNaN(t.getTime())) return null;
    var now = new Date(), guard = 0;
    // 1-hour grace: a run stays "current" until 1h after its start time, so a payment made
    // during or just after the run lands on THAT run's date, not next week's.
    while (t.getTime() + 3600000 < now.getTime() && guard++ < 520) t = new Date(t.getTime() + 7 * 86400000);
    return t;
  }
  function dubaiYMD(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  function weekdayType(d) { return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dubai' }).toLowerCase(); }

  // In-app browsers (Instagram / Facebook / TikTok / Snapchat webviews) frequently block
  // js.stripe.com, so window.Stripe never appears and checkout dead-ends. Detect that case
  // so we can tell the runner to open the link in a real browser instead of showing a
  // generic "payment library not loaded" error.
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

  ready(function () {
    // Prefer the shared auth client (lfg-supabase.js) so we read the same logged-in session.
    var sb = (window.lfg && window.lfg.sb) ? window.lfg.sb
           : ((window.supabase && window.supabase.createClient) ? window.supabase.createClient(SB_URL, SB_KEY) : null);

    var form = el('track-form');
    var errEl = el('track-error');
    var submitBtn = el('track-submit');
    var payWrap = el('track-pay');
    var payMount = el('track-pay-mount');
    var successWrap = el('track-success');
    var card = el('track-card');
    var notPaid = el('track-notpaid');
    var memberCard = el('track-member');

    // Fallback matches the static page text, so a failed config fetch never
    // shows one venue in the headline and another in the facts row.
    var RUN = { run_date: null, run_type: null, price: 30, paid: false, location: 'GEMS Dubai American Academy' };
    var embedded = null;

    function showError(msg) { errEl.textContent = msg; errEl.style.display = 'block'; errEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    function clearError() { errEl.textContent = ''; errEl.style.display = 'none'; }
    function setPrice(p) {
      var s = 'AED ' + p;
      var fp = el('fact-price'); if (fp) fp.innerHTML = s + '<small>per person</small>';
      ['card-price', 'btn-price', 'pay-price', 'tm-price'].forEach(function (id) { var e = el(id); if (e) e.textContent = s; });
    }

    // ---- level selector ----
    Array.prototype.slice.call(document.querySelectorAll('#track-levels .lvl')).forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('#track-levels .lvl').forEach(function (x) { x.classList.remove('sel'); });
        c.classList.add('sel'); c.querySelector('input').checked = true;
      });
    });

    // ---- load config, then check for a logged-in member ----
    loadConfig().then(setupMember);

    async function loadConfig() {
      if (!sb) return;
      try {
        var r = await sb.from('event_config')
          .select('location, event_datetime, run_paid, run_price_aed, run_map_url, run_tagline')
          .eq('id', 1).maybeSingle();
        var cfg = r && r.data; if (!cfg) return;

        RUN.paid = !!cfg.run_paid;
        RUN.price = (cfg.run_price_aed != null ? Number(cfg.run_price_aed) : 30);
        RUN.location = cfg.location || RUN.location;
        setPrice(RUN.price);

        // Title, description + map all follow the admin config so nothing needs hand-editing
        // when the venue changes. Title = "LFG × <location>", description = run_tagline.
        if (cfg.location) {
          var place = el('track-place'); if (place) place.textContent = cfg.location;
          document.title = 'LFG × ' + cfg.location + ' — Reserve Your Spot | LFG Dubai';
          var mp = el('track-map'); if (mp) mp.src = 'https://www.google.com/maps?q=' + encodeURIComponent(cfg.location) + '&output=embed';
        }
        var sub = el('track-sub'); if (sub && cfg.run_tagline) sub.textContent = cfg.run_tagline;

        var when = advanceIfPast(cfg.event_datetime);
        if (when) {
          RUN.run_date = dubaiYMD(when);
          RUN.run_type = weekdayType(when);
          var dayStr = when.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
          var timeStr = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
          var fw = el('fact-when'); if (fw) fw.innerHTML = dayStr + '<small>' + timeStr + '</small>';
        }
        var fwh = el('fact-where'); if (fwh) fwh.innerHTML = RUN.location + '<small>Tap the map below</small>';
        // The tap-through link must never disagree with the venue on the page
        // (a stale admin URL once sent runners to GEMS World Academy while the
        // page said Dubai American Academy, 2026-08-08). An explicit admin URL
        // wins; otherwise the link is derived from the same location string
        // the headline, facts row and embed already show.
        var mo = el('track-map-open');
        if (mo) {
          if (cfg.run_map_url) mo.href = cfg.run_map_url;
          else if (cfg.location) mo.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(cfg.location);
        }
        // Same rot class: the WhatsApp prefill named a venue in static text.
        var wa = el('track-wa');
        if (wa && cfg.location) {
          wa.href = 'https://wa.me/971504264410?text=' + encodeURIComponent('I want to join the ' + cfg.location + ' run');
        }

        if (!RUN.paid) { if (card) card.style.display = 'none'; if (notPaid) notPaid.style.display = 'block'; }
      } catch (e) { /* keep static defaults on any error */ }
    }

    // Logged-in member → hide the form, show the one-tap pay card prefilled from their account.
    async function setupMember() {
      if (!RUN.paid || !memberCard) return;
      if (!window.lfg || !window.lfg.getSettledSession) return;
      var session = null;
      try { session = await window.lfg.getSettledSession(); } catch (e) { return; }
      if (!session || !session.user) return; // guest → keep the form
      var meta = session.user.user_metadata || {};
      var fullName = meta.full_name || meta.name || (session.user.email || '').split('@')[0] || 'there';
      var first = String(fullName).trim().split(/\s+/)[0];
      var nameEl = el('track-member-name'); if (nameEl) nameEl.textContent = 'Hey ' + first;
      if (form) form.style.display = 'none';
      memberCard.hidden = false;
    }

    // ---- Instagram rule: mandatory for a NEW account, optional when a profile
    // is already on file. Checked on email blur; fails open (optional) so a
    // hiccup in the check can never block a payment.
    var igRequired = true;
    var igInput = el('track-ig');
    var emailInput = el('track-email');
    if (emailInput && igInput) emailInput.addEventListener('blur', function () {
      var email = emailInput.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
      fetch('/api/profile-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return;
        igRequired = !!d.instagram_required;
        var opt = el('track-ig-opt');
        if (opt) opt.hidden = igRequired;
      }).catch(function () {});
    });
    function cleanIg(v) {
      var s = String(v || '').trim().replace(/^@/, '');
      return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : null;
    }

    // ---- validation (guest form) ----
    function validate() {
      if (!el('track-first').value.trim()) return 'First name is required.';
      if (!el('track-last').value.trim()) return 'Last name is required.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el('track-email').value.trim())) return 'Enter a valid email.';
      if (el('track-phone').value.replace(/[^\d]/g, '').length < 7) return 'Enter a valid WhatsApp number.';
      if (igInput) {
        var igv = igInput.value.trim();
        if (igRequired && !igv) return 'Add your Instagram handle.';
        if (igv && !cleanIg(igv)) return 'That Instagram handle doesn’t look right.';
      }
      if (!form.querySelector('input[name="level"]:checked')) return 'Pick your level.';
      return null;
    }

    // ---- start Stripe embedded checkout (authed member OR guest email) ----
    async function startCheckout(opts) {
      opts = opts || {};
      var data = null, status = 0;
      try {
        if (opts.authed && window.lfg && window.lfg.api) {
          var r = await window.lfg.api('/api/run-pay', { method: 'POST', body: JSON.stringify({ run_date: RUN.run_date }) });
          status = r.status; data = r.data;
        } else {
          var res = await fetch('/api/run-pay', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: opts.email, run_date: RUN.run_date })
          });
          status = res.status; try { data = await res.json(); } catch (_) {}
        }
      } catch (e) { showError('Network error starting payment. Try again.'); return false; }

      if (status === 409) { showSuccess("You're already paid in for this run. See you there."); return true; }
      if (!data || !data.client_secret || !data.publishable_key) {
        showError((data && data.error) || 'Could not start payment. Try again or message us on WhatsApp.');
        return false;
      }
      var StripeLib = window.Stripe || await ensureStripe(6000);
      if (!StripeLib) {
        showError(isInAppBrowser()
          ? "Card payments are blocked inside the Instagram/in-app browser. Tap the ••• menu (top right) and choose “Open in Safari” or “Open in Chrome”, then pay from there."
          : "The payment library was blocked, usually by an ad or privacy blocker. Turn it off for this page, or open the link in a different browser, then try again."
        );
        return false;
      }

      if (form) form.style.display = 'none';
      if (memberCard) memberCard.hidden = true;
      payWrap.style.display = 'block';
      payWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });

      try {
        var stripe = StripeLib(data.publishable_key);
        embedded = await stripe.initEmbeddedCheckout({
          clientSecret: data.client_secret,
          onComplete: async function () {
            try {
              var st = await fetch('/api/run-pay?session_id=' + encodeURIComponent(data.id));
              var sd = await st.json();
              if (sd && sd.payment_status === 'paid') { destroy(); showSuccess(); }
            } catch (e) { destroy(); showSuccess(); }
          }
        });
        payMount.innerHTML = '';
        embedded.mount('#track-pay-mount');
        return true;
      } catch (e) {
        showError('Could not load checkout. Try again.');
        if (form) form.style.display = ''; payWrap.style.display = 'none';
        return false;
      }
    }

    function destroy() { try { if (embedded) embedded.destroy(); } catch (e) {} embedded = null; }

    function showSuccess(msg) {
      if (form) form.style.display = 'none';
      if (memberCard) memberCard.hidden = true;
      payWrap.style.display = 'none';
      if (msg) el('track-success-msg').textContent = msg;
      successWrap.style.display = 'block';
      successWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ---- member: one-tap pay ----
    var memPayBtn = el('track-member-pay');
    if (memPayBtn) memPayBtn.addEventListener('click', async function () {
      clearError();
      if (!RUN.paid || !RUN.run_date) { showError('This run is not open for paid registration right now.'); return; }
      memPayBtn.disabled = true; memPayBtn.textContent = 'One sec…';
      var ok = await startCheckout({ authed: true });
      if (!ok) { memPayBtn.disabled = false; memPayBtn.innerHTML = 'Pay <span id="tm-price">AED ' + RUN.price + '</span> &amp; reserve →'; }
    });
    var memSwitch = el('track-member-switch');
    if (memSwitch) memSwitch.addEventListener('click', function () {
      if (memberCard) memberCard.hidden = true;
      if (form) form.style.display = '';
    });

    // ---- guest: register then pay ----
    if (form) form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearError();
      var v = validate(); if (v) { showError(v); return; }
      if (!RUN.paid || !RUN.run_date) { showError('This run is not open for paid registration right now.'); return; }

      submitBtn.disabled = true; submitBtn.textContent = 'One sec…';

      var cc = el('track-cc').value;
      var phone = el('track-phone').value.replace(/[^\d]/g, '');
      if (phone.charAt(0) === '0') phone = phone.slice(1);
      var email = el('track-email').value.trim().toLowerCase();

      var payload = {
        source: 'track',
        first_name: el('track-first').value.trim(),
        last_name: el('track-last').value.trim(),
        email: email,
        whatsapp: cc + phone,
        instagram_handle: igInput ? (igInput.value.trim() || null) : null,
        level: (form.querySelector('input[name="level"]:checked') || {}).value || null,
        consent_marketing: true,
        website_url: el('track-hp').value, // honeypot
        run_date: RUN.run_date,
        run_type: RUN.run_type,
        utm_source: param('utm_source'),
        utm_medium: param('utm_medium'),
        utm_campaign: param('utm_campaign'),
        utm_content: param('utm_content'),
        referrer: document.referrer || null,
        landing_page: window.location.pathname + window.location.search
      };

      try {
        var reg = await fetch('/api/run-register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var rd = null; try { rd = await reg.json(); } catch (_) {}
        if (!reg.ok || !rd || !rd.ok) {
          showError((rd && rd.error) || 'Could not save your details. Try again.');
          submitBtn.disabled = false; submitBtn.innerHTML = 'Continue to payment · <span id="btn-price">AED ' + RUN.price + '</span>';
          return;
        }
      } catch (e2) {
        showError('Network error. Please try again.');
        submitBtn.disabled = false; submitBtn.innerHTML = 'Continue to payment · <span id="btn-price">AED ' + RUN.price + '</span>';
        return;
      }

      var ok = await startCheckout({ email: email });
      if (!ok) { submitBtn.disabled = false; submitBtn.innerHTML = 'Continue to payment · <span id="btn-price">AED ' + RUN.price + '</span>'; }
    });
  });
})();
