/* LFG checkout, built into the page (19 Nov 2026).
   Loay: "the actual stripe checkout IN the site", with Apple Pay working for everyone.

   One component for every place that takes money. Apple Pay / Google Pay / Link come
   first (96 of the last 100 paid charges used one of them), card fields sit under
   "or pay by card", and one button says the amount. It runs on Stripe Checkout
   Sessions in ui_mode 'elements', so the session, the webhook and each page's own
   GET ?session_id= verify are exactly what the embedded page used. Server side:
   checkoutUi() in api/_lib.js.

   Rollout switch. Off for everyone until it is proven on a real iPhone:
     ?checkout=new   turns it on in this browser (kept in localStorage)
     ?checkout=old   turns it off again
     DEFAULT_ON      flips it for everyone
   A page asks LFGPay.on() before starting a payment; when it is on, the page sends
   { ui: 'elements', return_path } with its create call and mounts with LFGPay.mount
   instead of stripe.initEmbeddedCheckout. LFGPay.mount returns { destroy() }, the same
   shape the pages already tear down.

   Stripe.js. The switch also picks the Stripe.js version, because no single version runs
   both checkouts (tested 19 Nov 2026): /v3/ still has initEmbeddedCheckout but refuses
   the Elements SDK ("upgrade to the Basil release or higher"), and /dahlia/ (the API
   version stripe-node 22 creates sessions with) runs the Elements SDK but has removed
   initEmbeddedCheckout. So: switch off, the page gets /v3/ and the embedded page exactly
   as before; switch on, /dahlia/. This file is the only place a page loads Stripe.js
   from; pages that loaded it up front mark this tag data-preload-stripe. */
(function () {
  'use strict';

  var DEFAULT_ON = false;
  var KEY = 'lfg_checkout';
  var WA = 'https://wa.me/971504264410?text=';
  var LOAD_MS = 15000;
  var UNKNOWN = 'We couldn\'t confirm whether that payment went through. Check your email for a receipt before you try again, or message us on WhatsApp.';
  var ROUTES = ['checkout', 'run-pay', 'padel-pay', 'trip-pay', 'event-pay'];
  var ME = document.currentScript;

  // ---------------------------------------------------------------- the switch
  try {
    var q = new URLSearchParams(location.search).get('checkout');
    if (q === 'new') localStorage.setItem(KEY, 'on');
    else if (q === 'old') localStorage.setItem(KEY, 'off');
  } catch (e) {}

  // Read once per page: the Stripe.js version below follows it, so it must not change
  // under a page that already loaded one.
  var ON = (function () {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    if (v === 'off') return false;
    return DEFAULT_ON || v === 'on';
  })();
  function on() { return ON; }
  var STRIPE_SRC = ON ? 'https://js.stripe.com/dahlia/stripe.js' : 'https://js.stripe.com/v3/';

  // ---------------------------------------------------------------- Stripe.js
  var stripeLoading = null;
  function loadStripe() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (stripeLoading) return stripeLoading;
    stripeLoading = new Promise(function (resolve, reject) {
      // In-app browsers sometimes block js.stripe.com outright; never wait forever.
      // One script tag per page, ever: a retry after a slow load waits on the same tag
      // instead of adding a second Stripe.js (two copies on a page break Stripe).
      var s = document.getElementById('lfgpay-stripe-js');
      var t = setTimeout(function () { stripeLoading = null; reject(new Error('Stripe.js timeout')); }, 10000);
      function ok() { clearTimeout(t); if (window.Stripe) resolve(window.Stripe); else { stripeLoading = null; reject(new Error('no Stripe')); } }
      function bad() { clearTimeout(t); stripeLoading = null; if (s && s.parentNode) s.parentNode.removeChild(s); reject(new Error('Stripe.js blocked')); }
      if (!s) {
        s = document.createElement('script');
        s.id = 'lfgpay-stripe-js';
        s.src = STRIPE_SRC;
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load', ok);
      s.addEventListener('error', bad);
    });
    return stripeLoading;
  }
  var stripes = {};
  function stripeFor(key) {
    return loadStripe().then(function (S) { return stripes[key] || (stripes[key] = S(key)); });
  }

  // ---------------------------------------------------------------- look
  // The site's own system (design/LFG-DESIGN-PLAYBOOK.md and the page tokens): ink
  // panels, hairline lines, square corners, olive #999966 for the one action, Barlow
  // for text, Barlow Condensed uppercase for labels and the button. Fields are 16px so
  // iPhones never zoom into them.
  var APPEARANCE = {
    theme: 'night',
    variables: {
      colorPrimary: '#999966',
      colorBackground: '#171717',
      colorText: '#ffffff',
      colorTextSecondary: 'rgba(255,255,255,0.52)',
      colorTextPlaceholder: 'rgba(255,255,255,0.34)',
      colorDanger: '#e0655e',
      colorIconTab: 'rgba(255,255,255,0.52)',
      fontFamily: 'Barlow, Arial, sans-serif',
      fontSizeBase: '16px',
      fontWeightNormal: '400',
      borderRadius: '0px',
      spacingUnit: '4px',
      gridRowSpacing: '14px'
    },
    rules: {
      '.Input': { border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none', padding: '14px 15px' },
      '.Input:focus': { borderColor: '#999966', boxShadow: '0 0 0 1px #999966' },
      '.Input--invalid': { borderColor: '#e0655e', boxShadow: '0 0 0 1px #e0655e' },
      '.Label': {
        fontFamily: '"Barlow Condensed", Arial, sans-serif',
        fontWeight: '600',
        fontSize: '12px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.52)'
      },
      '.Error': { color: '#e0655e', fontSize: '13px' },
      '.Tab': { border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none' },
      '.Tab--selected': { borderColor: '#999966', boxShadow: '0 0 0 1px #999966' }
    }
  };
  var FONTS = [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap' }];

  var CSS = [
    '.lfgpay{font-family:"Barlow",Arial,sans-serif;color:#fff;-webkit-font-smoothing:antialiased;text-align:left}',
    '.lfgpay *{box-sizing:border-box}',
    '.lfgpay [hidden]{display:none!important}',
    '.lfgpay-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:260px;color:rgba(255,255,255,.52);font-size:14px}',
    '.lfgpay-spin{width:26px;height:26px;border:2px solid rgba(255,255,255,.08);border-top-color:#999966;border-radius:50%;animation:lfgpay-spin .8s linear infinite}',
    '@keyframes lfgpay-spin{to{transform:rotate(360deg)}}',
    '.lfgpay-express.is-pending{height:0;overflow:hidden}',
    // A page's sticky "Book" bar sat on top of the Pay button on phones and took the tap.
    // Any element marked data-hide-during-pay steps aside while a checkout is open.
    'html.lfgpay-active [data-hide-during-pay]{display:none!important}',
    '.lfgpay-iab{margin:0 0 14px;padding:12px 14px;border:1px solid rgba(153,153,102,.4);background:rgba(153,153,102,.08);font-size:14px;line-height:1.5}',
    '.lfgpay-or{display:flex;align-items:center;gap:12px;margin:18px 0 16px;color:rgba(255,255,255,.34);font-family:"Barlow Condensed",Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}',
    '.lfgpay-or::before,.lfgpay-or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.08)}',
    '.lfgpay-contact{margin-bottom:14px}',
    '.lfgpay-name{display:block;margin:0 0 14px}',
    '.lfgpay-name span{display:block;margin-bottom:6px;font-family:"Barlow Condensed",Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.52)}',
    '.lfgpay-name input{width:100%;padding:14px 15px;background:#171717;border:1px solid rgba(255,255,255,.08);border-radius:0;color:#fff;font-family:"Barlow",Arial,sans-serif;font-size:16px;-webkit-appearance:none;appearance:none}',
    '.lfgpay-name input::placeholder{color:rgba(255,255,255,.34)}',
    '.lfgpay-name input:focus{outline:none;border-color:#999966;box-shadow:0 0 0 1px #999966}',
    '.lfgpay-err{margin:16px 0 0;padding:12px 14px;border:1px solid rgba(224,101,94,.45);background:rgba(224,101,94,.08);color:#f2b3ae;font-size:14px;line-height:1.5}',
    '.lfgpay-pay{width:100%;min-height:54px;margin-top:18px;padding:15px 18px;background:#999966;border:0;border-radius:0;color:#0A0A0A;font-family:"Barlow Condensed",Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:background-color .15s ease-out,transform .1s ease-out,opacity .15s ease-out;-webkit-tap-highlight-color:transparent}',
    '.lfgpay-pay:hover:not(:disabled){background:#bcbc86}',
    '.lfgpay-pay:active:not(:disabled){transform:translateY(1px) scale(.99);background:#8a8a5c}',
    '.lfgpay-pay:focus-visible{outline:2px solid #F4F1E9;outline-offset:3px}',
    '.lfgpay-pay:disabled{cursor:not-allowed;opacity:.55}',
    '.lfgpay-pay[aria-busy="true"]{opacity:1;cursor:progress}',
    '.lfgpay-dot{width:16px;height:16px;flex:none;border:2px solid rgba(10,10,10,.25);border-top-color:#0A0A0A;border-radius:50%;animation:lfgpay-spin .8s linear infinite}',
    '.lfgpay-note{margin:12px 0 0;color:rgba(255,255,255,.52);font-size:13px;line-height:1.5}',
    '.lfgpay a.lfgpay-help{display:inline-flex;align-items:center;min-height:44px;color:rgba(255,255,255,.52);font-size:13px;text-decoration:underline;text-underline-offset:3px}',
    '.lfgpay a.lfgpay-help:hover{color:#fff}',
    '.lfgpay-fail{padding:22px 0 6px}',
    '.lfgpay-fail p{color:rgba(255,255,255,.75);font-size:15px;line-height:1.5;margin:0 0 16px}',
    '.lfgpay-retry{width:100%;min-height:50px;padding:14px;background:transparent;border:1px solid rgba(255,255,255,.22);border-radius:0;color:#fff;font-family:"Barlow Condensed",Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:border-color .15s ease-out,background-color .15s ease-out,transform .1s ease-out}',
    '.lfgpay-retry:hover{border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.04)}',
    '.lfgpay-retry:active{transform:translateY(1px)}',
    '.lfgpay-retry:focus-visible{outline:2px solid #F4F1E9;outline-offset:3px}',
    '.lfgpay-banner{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:300;width:min(92vw,440px);padding:14px 16px;background:#171717;border:1px solid rgba(153,153,102,.5);color:#fff;font-family:"Barlow",Arial,sans-serif;font-size:14px;line-height:1.5}',
    '@media (prefers-reduced-motion:reduce){.lfgpay-spin,.lfgpay-dot{animation-duration:2.4s}.lfgpay-pay,.lfgpay-retry{transition:none}.lfgpay-pay:active:not(:disabled),.lfgpay-retry:active{transform:none}}'
  ].join('');

  function injectCss() {
    if (document.getElementById('lfgpay-css')) return;
    var st = document.createElement('style');
    st.id = 'lfgpay-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(session) {
    try {
      // Stripe's contract: divide minor units by the session's own divisor, never a
      // hard-coded 100 (zero- and three-decimal currencies differ).
      // The divisor lives on the session (dahlia: session.minorUnitsAmountDivisor, probed
      // 19 Nov); total.total carries only amount + minorUnitsAmount.
      var t = session.total.total;
      var minor = t.minorUnitsAmount;
      var div = session.minorUnitsAmountDivisor || t.minorUnitsAmountDivisor || 100;
      var cur = String(session.currency || 'aed').toUpperCase();
      var n = minor / div;
      return cur + ' ' + (n % 1 === 0 ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    } catch (e) { return ''; }
  }
  function knownEmail(session) {
    return !!(session && (session.email || (session.customer && session.customer.email)));
  }
  function inAppBrowser() {
    try { if (window.lfg && window.lfg.isEmbeddedBrowser) return !!window.lfg.isEmbeddedBrowser(); } catch (e) {}
    return /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|LinkedInApp/i.test(navigator.userAgent || '');
  }
  function iOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function waLink(text) {
    return WA + encodeURIComponent(text || 'Hi LFG, I had trouble paying on the site.');
  }

  var openCount = 0;

  // ---------------------------------------------------------------- mount
  // target: selector or element. opts: { clientSecret, publishableKey, onComplete(session),
  // onRetry(), waText }. Resolves to { destroy() } once the step is on screen or has
  // settled into its error state; it never rejects.
  function mount(target, opts) {
    opts = opts || {};
    injectCss();
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    var dead = false;
    var els = [];
    var actions = null;
    var paying = false;
    var payLabel = 'Pay';
    var timer = null;
    var holding = false;
    function hold(on) {
      if (on === holding) return;
      holding = on;
      openCount = Math.max(0, openCount + (on ? 1 : -1));
      document.documentElement.classList.toggle('lfgpay-active', openCount > 0);
    }
    var ctl = {
      destroy: function () {
        dead = true;
        clearTimeout(timer);
        hold(false);
        els.forEach(function (e) { try { e.destroy(); } catch (x) {} });
        els = [];
      }
    };
    if (!root) return Promise.resolve(ctl);
    hold(true);

    root.innerHTML =
      '<div class="lfgpay" aria-live="polite">' +
        '<div class="lfgpay-load"><span class="lfgpay-spin" aria-hidden="true"></span><span>Loading secure checkout…</span></div>' +
        '<div class="lfgpay-body" hidden>' +
          '<p class="lfgpay-iab" hidden>Want Apple Pay? Open this page in Safari: tap ••• then Open in browser.</p>' +
          '<div class="lfgpay-express is-pending"></div>' +
          '<div class="lfgpay-or" hidden><span>or pay by card</span></div>' +
          '<label class="lfgpay-name"' + (opts.collectName ? '' : ' hidden') + '><span>Your name</span>' +
            '<input type="text" class="lfgpay-name-input" autocomplete="name" autocapitalize="words" maxlength="80" placeholder="First and last name"></label>' +
          '<div class="lfgpay-contact" hidden></div>' +
          '<div class="lfgpay-card"></div>' +
          '<p class="lfgpay-err" role="alert" hidden></p>' +
          '<button type="button" class="lfgpay-pay"><span class="lfgpay-pay-label">Pay</span></button>' +
          '<p class="lfgpay-note">Payment runs through Stripe. LFG never sees your card number.</p>' +
          '<a class="lfgpay-help" target="_blank" rel="noopener" href="' + esc(waLink(opts.waText)) + '">Message us on WhatsApp</a>' +
        '</div>' +
        '<div class="lfgpay-fail" hidden>' +
          '<p>Checkout didn\'t load. Check your connection and try again.</p>' +
          '<button type="button" class="lfgpay-retry">Try again</button>' +
          '<a class="lfgpay-help" target="_blank" rel="noopener" href="' + esc(waLink(opts.waText)) + '">Message us on WhatsApp</a>' +
        '</div>' +
      '</div>';
    function q(sel) { return root.querySelector(sel); }
    var payBtn = q('.lfgpay-pay');

    function setPending(on, label) {
      payBtn.disabled = on;
      if (on) payBtn.setAttribute('aria-busy', 'true'); else payBtn.removeAttribute('aria-busy');
      payBtn.innerHTML = on
        ? '<span class="lfgpay-dot" aria-hidden="true"></span><span class="lfgpay-pay-label">' + esc(label || 'Paying…') + '</span>'
        : '<span class="lfgpay-pay-label">' + esc(payLabel) + '</span>';
    }
    function showErr(msg) {
      var e = q('.lfgpay-err');
      e.textContent = msg;
      e.hidden = false;
    }
    function hideErr() { q('.lfgpay-err').hidden = true; }
    var shown = false;
    var failed = false;
    var settle = null; // resolves what the page awaits; set below
    function failLoad() {
      if (dead || failed) return;
      failed = true;
      clearTimeout(timer);
      // Release the page's own in-flight guard BEFORE Try again can be tapped (padel and
      // Musandam ignore a restart while their guard is up).
      if (settle) settle(ctl);
      els.forEach(function (e) { try { e.destroy(); } catch (x) {} });
      els = [];
      q('.lfgpay-load').hidden = true;
      q('.lfgpay-body').hidden = true;
      q('.lfgpay-fail').hidden = false;
    }
    q('.lfgpay-retry').addEventListener('click', function () {
      ctl.destroy();
      if (typeof opts.onRetry === 'function') opts.onRetry();
      else location.reload();
    });

    function pay(expressEvent) {
      if (paying || !actions || dead) return;
      // A buyer the page doesn't know (anonymous sponsor) gives their name here; the
      // embedded page always asked for a cardholder name. A wallet supplies its own,
      // so only the card path insists.
      var nameIn = q('.lfgpay-name-input');
      var name = opts.collectName && nameIn ? nameIn.value.replace(/\s+/g, ' ').trim() : '';
      if (opts.collectName && !name && !expressEvent) {
        showErr('Add your name above, so we know who paid.');
        nameIn.focus();
        return;
      }
      paying = true;
      hideErr();
      setPending(true);
      var args = { redirect: 'if_required' };
      if (expressEvent) args.expressCheckoutConfirmEvent = expressEvent;
      // The name is optional on the session, so a failed or slow update never blocks the
      // payment: wait at most 5 s, then confirm. Nothing confirms once the step is closed.
      var before = name && actions.updateIndividualName
        ? Promise.race([
            actions.updateIndividualName(name).catch(function () {}),
            new Promise(function (r) { setTimeout(r, 5000); })
          ])
        : Promise.resolve();
      before.then(function () { return dead ? null : actions.confirm(args); }).then(function (res) {
        if (dead) return;
        if (res && res.type === 'success') {
          setPending(true, 'Paid');
          hold(false);
          if (typeof opts.onComplete === 'function') opts.onComplete(res.session);
          return;
        }
        paying = false;
        setPending(false);
        var err = (res && res.error) || {};
        var msg = String(err.message || '').trim();
        // A field the customer still has to fix: Stripe marks it in place, so the line
        // above the button only repeats what to fix. A decline or a rejected request is
        // a payment that did not happen, and saying so stops a nervous second try. A
        // connection or server error is unknown: say that, and point at the receipt
        // before any second attempt, so nobody pays twice.
        if (err.type === 'validation_error' || /^(incomplete|invalid)_/.test(err.code || '')) {
          showErr(msg || 'Check your card details.');
        } else if (err.type === 'card_error' || err.type === 'invalid_request_error') {
          showErr('Payment didn\'t go through.' + (msg ? ' ' + msg : '') + ' Nothing was charged. Try again or use another card.');
        } else {
          showErr(UNKNOWN);
        }
      }, function () {
        if (dead) return;
        paying = false;
        setPending(false);
        showErr(UNKNOWN);
      });
    }
    payBtn.addEventListener('click', function () { pay(null); });

    // Bounded on what the customer sees: the card form on screen, not just Stripe answering.
    timer = setTimeout(function () { if (!shown) failLoad(); }, LOAD_MS);

    var chain = stripeFor(opts.publishableKey).then(function (stripe) {
      if (dead || failed) return ctl;
      var checkout = stripe.initCheckoutElementsSdk({
        clientSecret: opts.clientSecret,
        elementsOptions: { appearance: APPEARANCE, fonts: FONTS }
      });
      return checkout.loadActions().then(function (r) {
        if (dead || failed) return ctl;
        if (!r || r.type !== 'success') { failLoad(); return ctl; }
        actions = r.actions;
        var session = actions.getSession();
        var amount = money(session);
        payLabel = amount ? 'Pay ' + amount : 'Pay now';
        setPending(false);

        // Wallets first. Stripe shows only what this device can use: Apple Pay on an
        // iPhone in Safari, Google Pay on Android Chrome, Link anywhere.
        var express = checkout.createExpressCheckoutElement({
          buttonHeight: 50,
          buttonTheme: { applePay: 'white', googlePay: 'white' },
          buttonType: { applePay: 'buy', googlePay: 'buy' },
          // One button per row, up to four. (overflow: 'never' with maxRows > 0 is an
          // IntegrationError that stops the buttons rendering at all: caught 19 Nov.)
          layout: { maxColumns: 1, maxRows: 4 },
          paymentMethodOrder: ['apple_pay', 'google_pay', 'link']
        });
        express.on('ready', function (ev) {
          if (dead) return;
          var avail = ev && ev.availablePaymentMethods;
          var list = avail ? Object.keys(avail).filter(function (k) { return avail[k]; }) : [];
          var any = list.length > 0;
          // Collapsed until Stripe says which buttons this device gets, so a device with
          // none never shows an empty band above the card fields.
          q('.lfgpay-express').classList.remove('is-pending');
          q('.lfgpay-express').hidden = !any;
          q('.lfgpay-or').hidden = !any;
          // What the device was offered, for checking a real phone: data-wallets on .lfgpay.
          q('.lfgpay').setAttribute('data-wallets', any ? list.join(',') : 'none');
          // Instagram's and Facebook's in-app browsers hide Apple Pay. Say where it lives.
          if (iOS() && inAppBrowser() && !(avail && avail.applePay)) q('.lfgpay-iab').hidden = false;
        });
        express.on('confirm', function (ev) { pay(ev); });
        express.mount(q('.lfgpay-express'));
        els.push(express);

        // Email only when the page did not already know it (anonymous shop and sponsor).
        if (!knownEmail(session)) {
          var contact = checkout.createContactDetailsElement();
          contact.mount(q('.lfgpay-contact'));
          q('.lfgpay-contact').hidden = false;
          els.push(contact);
        }

        // Card. Wallets live in the buttons above, so the card form does not repeat them,
        // and Link's "save my information" sign-up (phone, full name) stays out of a
        // one-tap payment: people who already use Link get it as a button above.
        var card = checkout.createPaymentElement({
          layout: 'tabs',
          wallets: { applePay: 'never', googlePay: 'never', link: 'never' }
        });
        function show() {
          if (shown || dead || failed) return;
          shown = true;
          clearTimeout(timer);
          q('.lfgpay-load').hidden = true;
          q('.lfgpay-body').hidden = false;
        }
        card.on('ready', show);
        card.on('loaderror', failLoad);
        card.mount(q('.lfgpay-card'));
        els.push(card);
        return ctl;
      });
    }).catch(function () { failLoad(); return ctl; });

    // The page awaits this, often behind its own "in flight" guard, so it settles even
    // when Stripe hangs; otherwise Try again would hit that guard and do nothing.
    return new Promise(function (resolve) {
      settle = resolve;
      chain.then(resolve, function () { resolve(ctl); });
      setTimeout(function () { resolve(ctl); }, LOAD_MS + 50);
    });
  }

  // ---------------------------------------------------------------- coming back
  // Card, Apple Pay, Google Pay and Link confirm on the page. A method that leaves it
  // returns to return_url (checkoutUi in api/_lib.js) with ?lfgpay=<route>&session_id=.
  // Verify with that route's own GET, say what happened, and tidy the address bar.
  // Kept in sessionStorage for 30 s: some pages reload once when the service worker
  // takes over on a first visit (bootcamp.html, controllerchange), and the cleaned
  // address bar would otherwise lose the return before the banner is seen.
  var RETURN_KEY = 'lfgpay_return';
  function validReturn(route, sid) {
    return !!route && !!sid && ROUTES.indexOf(route) !== -1 && /^cs_[A-Za-z0-9_]+$/.test(sid);
  }
  function handleReturn() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }
    var route = p.get('lfgpay');
    var sid = p.get('session_id');
    if (validReturn(route, sid)) {
      try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ route: route, sid: sid, t: Date.now(), p: location.pathname })); } catch (e) {}
      try {
        p.delete('lfgpay');
        p.delete('session_id');
        var rest = p.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      } catch (e) {}
    } else {
      var kept = null;
      try { kept = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null'); } catch (e) {}
      // Only on the page the payment came back to, never on the next page they open.
      if (!kept || Date.now() - kept.t > 30000 || kept.p !== location.pathname || !validReturn(kept.route, kept.sid)) return;
      route = kept.route;
      sid = kept.sid;
    }
    setTimeout(function () { try { sessionStorage.removeItem(RETURN_KEY); } catch (e) {} }, 30000);
    var url = '/api/' + route + '?session_id=' + encodeURIComponent(sid);
    var get = window.lfg && window.lfg.api
      ? window.lfg.api(url).then(function (r) { return r && r.data; })
      : fetch(url).then(function (r) { return r.json(); });
    get.then(function (d) {
      var paid = d && (d.payment_status === 'paid' || d.paid === true || d.status === 'paid');
      banner(paid
        ? 'Payment received. Your receipt is on its way to your email.'
        : 'Your payment is going through. We\'ll email you once it lands.');
    }, function () {
      banner('Your payment is going through. We\'ll email you once it lands.');
    });
  }
  function banner(text) {
    injectCss();
    var b = document.createElement('div');
    b.className = 'lfgpay-banner';
    b.setAttribute('role', 'status');
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 9000);
  }

  // ---------------------------------------------------------------- page glue
  // What every page calls, so each page changes two lines and today's path stays as it
  // was while the switch is off.
  //   body(payload)  adds { ui: 'elements', return_path } to a create request when on.
  //   start(target, data, onComplete, opts)  mounts this checkout when on, or Stripe's
  //   embedded page exactly as before when off. data is the create response
  //   ({ client_secret, publishable_key }). Resolves to an object with destroy().
  //   The embedded path can reject (the page's own catch handles it, as before); the
  //   Elements path settles into its own error state and never rejects.
  function body(payload) {
    payload = payload || {};
    if (!on()) return payload;
    var out = {};
    Object.keys(payload).forEach(function (k) { out[k] = payload[k]; });
    out.ui = 'elements';
    out.return_path = location.pathname || '/';
    return out;
  }
  function start(target, data, onComplete, opts) {
    opts = opts || {};
    if (on()) {
      return mount(target, {
        clientSecret: data.client_secret,
        publishableKey: data.publishable_key,
        collectName: !!data.collect_name,
        onComplete: onComplete,
        onRetry: opts.onRetry,
        waText: opts.waText
      });
    }
    return stripeFor(data.publishable_key).then(function (stripe) {
      // /v3/ names it initEmbeddedCheckout; versioned Stripe.js renamed it.
      var init = stripe.initEmbeddedCheckout || stripe.createEmbeddedCheckoutPage;
      return init.call(stripe, { clientSecret: data.client_secret, onComplete: onComplete });
    }).then(function (embedded) {
      // Stripe mounts only into an empty box. Pages put "Loading secure checkout…" there
      // first and the old code cleared it right before mounting; without this the
      // embedded page failed to load on track, events, padel, Musandam and bookings
      // (caught by the switch-off test, 19 Nov).
      var box = typeof target === 'string' ? document.querySelector(target) : target;
      if (box) box.innerHTML = '';
      embedded.mount(target);
      return embedded;
    });
  }

  window.LFGPay = { on: on, body: body, start: start, mount: mount, loadStripe: loadStripe, STRIPE_SRC: STRIPE_SRC };
  // Pages that always had Stripe.js in their head keep loading it up front.
  if (ME && ME.hasAttribute('data-preload-stripe')) loadStripe().catch(function () {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', handleReturn);
  else handleReturn();
})();
