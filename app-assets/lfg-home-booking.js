// Rewires the homepage #bootcamp-booking module to the LFG flow:
// featured next-Sunday card (live sign-ups + fill bar + scarcity), price on the
// BOOK NOW button, package offers strip, in-modal package upsell, section picking,
// success screen, and post-Stripe return confirmation. Requires lfg-supabase.js.
(function () {
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    if (!window.lfg) { console.warn('[lfg-home-booking] window.lfg missing'); return; }
    var datesWrap = document.getElementById('bootcamp-dates');
    var bookBtn = document.querySelector('.bootcamp-book-btn');
    if (!datesWrap || !bookBtn) return;

    // Bootcamp waiver / liability terms - opens the live LFG terms doc in a new tab.
    // Implicit consent via conduct: by clicking pay/book, members agree (no checkbox).
    var TERMS_URL = 'https://docs.google.com/document/d/1Pjfk3Nx7x2IhRCc5D0gqXnaSo0bjyZsBxoHAQq9CKE0/mobilebasic';
    var TERMS_LINE = 'By booking, you agree to our <a href="' + TERMS_URL + '" target="_blank" rel="noopener" class="lfgw-terms-link">Terms</a>.';

    var sub = document.querySelector('.bootcamp-booking-sub');
    var note = document.querySelector('.bootcamp-book-note');
    if (sub) sub.textContent = 'Spots fill every week. Lock in your next Sunday before it’s gone.';
    if (note) note.innerHTML = 'Secure checkout. ' + TERMS_LINE;
    bookBtn.removeAttribute('target');
    bookBtn.setAttribute('href', '#book');
    var ARROW = ' <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

    var sessions = [], packages = [], singlePrice = 99, credits = 0, loggedIn = false;
    var pickedSection = null, activeBookingId = null;
    var featuredEl = null, labelEl = null, offersEl = null, laidOut = false;
    // Applied promo for the currently-open modal. Wiped when the modal closes.
    // Shape: { code, label, final_amount, discount_amount, kind: 'single'|'package' }
    var appliedPromo = null;
    var activePackageId = null;
    var embeddedCheckout = null; // live Stripe embedded-checkout instance, if mounted

    var overlay = document.createElement('div');
    overlay.className = 'lfgw-overlay';
    overlay.innerHTML = '<div class="lfgw-modal"></div>';
    document.body.appendChild(overlay);
    var modalEl = overlay.querySelector('.lfgw-modal');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    var toast = document.createElement('div'); toast.className = 'lfgw-toast'; document.body.appendChild(toast);
    function showToast(m, e) { toast.textContent = m; toast.className = 'lfgw-toast show' + (e ? ' err' : ''); setTimeout(function () { toast.className = 'lfgw-toast'; }, 3600); }
    function closeModal() { destroyEmbedded(); overlay.classList.remove('show'); modalEl.classList.remove('co'); appliedPromo = null; activePackageId = null; }

    // Markup for the promo input + state row. The input is hidden behind a
    // "Have a promo code?" toggle so it doesn't clutter the modal for everyone.
    function promoBlockMarkup() {
      if (appliedPromo) {
        var moneyRow;
        if (appliedPromo.kind === 'single') {
          moneyRow = '<s>AED ' + singlePrice + '</s> <b>AED ' + appliedPromo.final_amount + '</b>';
        } else {
          moneyRow = '<b>You save AED ' + appliedPromo.discount_amount + '</b>';
        }
        return '<div class="lfgw-promo applied" id="lfgwPromoBlock">' +
          '<div class="lfgw-promo-applied">' +
            '<div class="lpa-l"><b>' + appliedPromo.code + '</b> · ' + appliedPromo.label + '</div>' +
            '<div class="lpa-r">' + moneyRow + ' <button class="lfgw-promo-x" id="lfgwPromoX" type="button" aria-label="Remove">&times;</button></div>' +
          '</div></div>';
      }
      return '<div class="lfgw-promo" id="lfgwPromoBlock">' +
        '<button class="lfgw-promo-toggle" id="lfgwPromoToggle" type="button">Have a promo code?</button>' +
        '<div class="lfgw-promo-field" id="lfgwPromoField" hidden>' +
          '<input type="text" id="lfgwPromoInput" maxlength="32" placeholder="ENTER CODE" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
          '<button class="lfgw-promo-apply" id="lfgwPromoApply" type="button">Apply</button>' +
        '</div>' +
        '<div class="lfgw-promo-msg" id="lfgwPromoMsg"></div>' +
      '</div>';
    }

    function wirePromoBlock(kind, packageIdForValidate) {
      var toggle = document.getElementById('lfgwPromoToggle');
      var field = document.getElementById('lfgwPromoField');
      var input = document.getElementById('lfgwPromoInput');
      var apply = document.getElementById('lfgwPromoApply');
      var msg = document.getElementById('lfgwPromoMsg');
      var removeX = document.getElementById('lfgwPromoX');

      if (toggle && field) {
        toggle.addEventListener('click', function () {
          field.hidden = false; toggle.style.display = 'none';
          setTimeout(function () { input && input.focus(); }, 30);
        });
      }
      if (apply && input) {
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply.click(); } });
        apply.addEventListener('click', async function () {
          var raw = (input.value || '').trim();
          if (!raw) { msg.textContent = 'Enter a code.'; msg.className = 'lfgw-promo-msg err'; return; }
          apply.disabled = true; apply.textContent = 'Checking…';
          msg.textContent = ''; msg.className = 'lfgw-promo-msg';
          var payload = { code: raw, kind: kind };
          if (kind === 'package') payload.package_id = packageIdForValidate;
          var res = await window.lfg.api('/api/validate-promo', { method: 'POST', body: JSON.stringify(payload) });
          apply.disabled = false; apply.textContent = 'Apply';
          if (res.ok && res.data && res.data.ok) {
            appliedPromo = { code: res.data.code, label: res.data.label, final_amount: res.data.final_amount, discount_amount: res.data.discount_amount, kind: kind };
            // Re-render the promo block + price-bearing button labels.
            document.getElementById('lfgwPromoBlock').outerHTML = promoBlockMarkup();
            wirePromoBlock(kind, packageIdForValidate);
            if (kind === 'single') renderActions();
            if (kind === 'package') renderPackageActions();
          } else {
            msg.textContent = (res.data && res.data.error) || 'Could not validate';
            msg.className = 'lfgw-promo-msg err';
          }
        });
      }
      if (removeX) {
        removeX.addEventListener('click', function () {
          appliedPromo = null;
          document.getElementById('lfgwPromoBlock').outerHTML = promoBlockMarkup();
          wirePromoBlock(kind, packageIdForValidate);
          if (kind === 'single') renderActions();
          if (kind === 'package') renderPackageActions();
        });
      }
    }

    function fmtCard(s) {
      var d = new Date(s.session_date + 'T12:30:00');
      return { date: d.getDate() + ' ' + d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(), full: 'Sun ' + d.getDate() + ' ' + d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() };
    }
    // Display time comes from the session's start_time (set on the Schedule tab), not a
    // hardcoded value, so changing the bootcamp time updates the booking page everywhere.
    function fmtTime(s) {
      var t = s && s.start_time;
      if (!t) return '12:30 PM';
      var p = String(t).split(':'); var h = parseInt(p[0], 10); var m = (p[1] || '00');
      if (isNaN(h)) return '12:30 PM';
      var ap = h >= 12 ? 'PM' : 'AM'; var h12 = h % 12; if (h12 === 0) h12 = 12;
      return h12 + ':' + m + ' ' + ap;
    }
    function byId(id) { return sessions.find(function (s) { return s.id === id; }); }
    function savings(p) { return Math.max(0, singlePrice * p.sessions_count - p.price_aed); }

    function injectHeader() {
      // Desktop nav: only show the "Sign in" text link for signed-out visitors so they
      // have a discoverable entry. For signed-in members the circular profile icon
      // (.nav-account / .bc-nav-account) is the single, consistent account entry point.
      var existing = document.getElementById('lfgw-acct');
      if (loggedIn) {
        if (existing) existing.remove();
      } else {
        var a = existing;
        if (!a) {
          var cta = document.querySelector('.nav-cta'); if (!cta) return;
          a = document.createElement('a'); a.id = 'lfgw-acct'; a.className = 'lfgw-acct-btn';
          var ctaLi = cta.parentElement && cta.parentElement.tagName === 'LI' ? cta.parentElement : null;
          if (ctaLi) { var li = document.createElement('li'); li.appendChild(a); ctaLi.parentNode.insertBefore(li, ctaLi); }
          else { cta.parentNode.insertBefore(a, cta); }
        }
        a.href = '/login'; a.textContent = 'Sign in';
      }
      // Mobile slide-out menu: dynamic label so the link contextually matches state.
      // The circular profile icon in the nav bar is the other (always-visible) entry.
      var mm = document.getElementById('mmAuth');
      if (mm) mm.innerHTML = loggedIn
        ? '<a href="/account" data-mm>My account</a>'
        : '<a href="/login" data-mm>Sign in</a>';
    }

    // Hamburger ↔ mobile menu.
    (function wireBurger() {
      var burger = document.getElementById('navBurger'), menu = document.getElementById('mobileMenu'), closeBtn = document.getElementById('mmClose');
      if (!burger || !menu) return;
      function closeMenu() { menu.classList.remove('open'); burger.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }
      burger.addEventListener('click', function () {
        var open = !menu.classList.contains('open');
        menu.classList.toggle('open', open); burger.classList.toggle('open', open);
        burger.setAttribute('aria-expanded', String(open)); document.body.style.overflow = open ? 'hidden' : '';
      });
      if (closeBtn) closeBtn.addEventListener('click', closeMenu);
      menu.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(); });
    })();

    function setBookBtnLabel() {
      var label = (loggedIn && credits > 0) ? 'Book Now · 1 credit' : 'Book Now · ' + singlePrice + ' AED';
      bookBtn.innerHTML = label + ARROW;
    }

    function ensureLayout() {
      if (laidOut) return;
      featuredEl = document.createElement('div'); featuredEl.className = 'lfgw-feat';
      labelEl = document.createElement('div'); labelEl.className = 'lfgw-more-label'; labelEl.textContent = 'Or pick another Sunday';
      offersEl = document.createElement('div'); offersEl.className = 'lfgw-offers';
      var parent = datesWrap.parentNode;
      parent.insertBefore(featuredEl, datesWrap);
      parent.insertBefore(bookBtn, datesWrap);
      parent.insertBefore(labelEl, datesWrap);
      parent.insertBefore(offersEl, datesWrap.nextSibling); // offers after dates
      laidOut = true;
    }

    function renderFeatured(s) {
      if (!s) { featuredEl.style.display = 'none'; bookBtn.style.display = 'none'; return; }
      featuredEl.style.display = ''; bookBtn.style.display = '';
      var c = fmtCard(s);
      var pct = s.capacity ? Math.min(100, Math.round(s.booked / s.capacity * 100)) : 0;
      var hot = s.spots_left <= 8 ? ' hot' : '';
      var stats = s.booked === 0
        ? 'Be the first in · <span class="urge' + hot + '">' + s.spots_left + ' spots open</span>'
        : '<b>' + s.booked + '</b> booked · <span class="urge' + hot + '">' + s.spots_left + ' spot' + (s.spots_left === 1 ? '' : 's') + ' left</span>';
      if (s.spots_left <= 8 && !s.sold_out) stats += ' &nbsp;·&nbsp; <span class="urge hot">Filling fast</span>';
      featuredEl.innerHTML =
        '<div class="lfgw-feat-tag">Next session · Sunday</div>' +
        '<div class="lfgw-feat-date">' + c.full + ' · ' + fmtTime(s) + '</div>' +
        '<div class="lfgw-feat-sub">' + (s.location || 'CrossFit Alioth') + '</div>' +
        '<div class="lfgw-feat-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="lfgw-feat-stats">' + stats + '</div>';
    }

    function renderSecondary(list) {
      if (!list.length) { datesWrap.style.display = 'none'; labelEl.style.display = 'none'; return; }
      datesWrap.style.display = ''; labelEl.style.display = '';
      datesWrap.innerHTML = list.map(function (s) {
        var c = fmtCard(s), sold = s.sold_out ? ' lfgw-soldout' : '';
        return '<button class="bootcamp-date-card' + sold + '" type="button" data-sid="' + s.id + '"' + (s.sold_out ? ' disabled' : '') + '>' +
          '<span class="bdc-day">SUN</span><span class="bdc-date">' + c.date + '</span>' +
          '<span class="bdc-time">' + (s.sold_out ? 'Sold out' : s.spots_left + ' left') + '</span></button>';
      }).join('');
      datesWrap.querySelectorAll('[data-sid]').forEach(function (b) {
        b.addEventListener('click', function () { startBooking(b.getAttribute('data-sid')); });
      });
    }

    function renderOffers() {
      if (!offersEl) return;
      var cards = packages.map(function (p) {
        var anchor = singlePrice * p.sessions_count;
        var per = Math.round(p.price_aed / p.sessions_count);
        var saved = anchor - p.price_aed;
        var pop = p.sessions_count === 8;
        var best = p.sessions_count === 12;
        var badge = pop ? '<div class="pk-badge">Most popular</div>' : (best ? '<div class="pk-badge">Best value</div>' : '');
        // Only the pack we want to push carries the explicit savings line + sheen.
        var shine = best ? '<span class="pk-shine" aria-hidden="true"></span>' : '';
        var saveLine = best ? '<div class="pk-save">You save AED ' + saved.toLocaleString() + '</div>' : '';
        return '<div class="lfgw-pkgcard' + (pop ? ' pop' : '') + (best ? ' best' : '') + '" data-pkg="' + p.id + '">' + shine + badge +
          '<div class="pk-credits">' + p.sessions_count + '<span>credits</span></div>' +
          '<div class="pk-anchor"><s>AED ' + anchor.toLocaleString() + '</s></div>' +
          '<div class="pk-price">AED ' + p.price_aed + '</div>' +
          saveLine +
          '<div class="pk-per">' + per + ' / session · ' + p.validity_months + ' mo</div>' +
          '<button class="pk-buy" type="button">Get this pack</button></div>';
      }).join('');
      offersEl.innerHTML = '<div class="lfgw-offers-h">Buy a pack. Train more, pay less.</div>' +
        '<div class="lfgw-pkgs">' + cards + '</div>' +
        '<div class="lfgw-single-note">Or pay as you go. <b>Single session ' + singlePrice + ' AED.</b></div>';
      offersEl.querySelectorAll('.lfgw-pkgcard').forEach(function (card) {
        card.addEventListener('click', function () { buyPackage(Number(card.getAttribute('data-pkg'))); });
      });
    }

    async function refresh() {
      // Fire the three independent reads together so the fold paints after the
      // slowest single round-trip, not the sum of three (sessions + packages + auth).
      // /api/me still resolves after, since it only refines the button label.
      var res = await Promise.all([
        window.lfg.api('/api/sessions'),
        window.lfg.api('/api/packages'),
        window.lfg.getSession()
      ]);
      var sres = res[0], pres = res[1], session = res[2];
      sessions = (sres.data && sres.data.sessions) || [];
      if (pres.ok) { packages = pres.data.packages || []; singlePrice = pres.data.single_price || 99; }
      ensureLayout();
      renderFeatured(sessions[0]);
      renderSecondary(sessions.slice(1, 4));
      renderOffers();
      // Bootcamp page: show recent Sunday photos as their own dated tiles. Each photo
      // stays tied to its session date and is added below the gallery - nothing in the
      // brand gallery is replaced. No-ops on pages without the container (e.g. home).
      var recentPhotos = (sres.data && sres.data.recent_photos) || [];
      var photosWrap = document.getElementById('bc-session-photos-wrap');
      var photosGrid = document.getElementById('bc-session-photos');
      if (photosWrap && photosGrid) {
        if (recentPhotos.length) {
          photosGrid.innerHTML = recentPhotos.map(function (p) {
            return '<figure class="bc-sphoto"><img src="' + encodeURI(p.photo_url) +
              '" alt="LFG bootcamp · ' + p.date_label + '" loading="lazy">' +
              '<figcaption>' + p.date_label + '</figcaption></figure>';
          }).join('');
          photosWrap.hidden = false;
        } else {
          photosWrap.hidden = true;
        }
      }
      loggedIn = !!session;
      if (loggedIn) { var me = await window.lfg.api('/api/me'); credits = (me.ok && me.data.sessions_remaining) || 0; }
      setBookBtnLabel();
      injectHeader();
    }

    async function startBooking(sessionId) {
      if (!loggedIn) {
        // Re-verify before bouncing: the load-time read may have raced the PWA's
        // session restore. Only send a genuinely logged-out user to /login.
        var s = await window.lfg.ensureSession();
        if (s) { await markLoggedIn(); }
        else {
          sessionStorage.setItem('lfg_book_after_login', sessionId || '');
          sessionStorage.setItem('lfg_book_return_path', window.location.pathname);
          window.location.href = '/login';
          return;
        }
      }
      openBookingModal(sessionId);
    }
    bookBtn.addEventListener('click', function (e) { e.preventDefault(); startBooking(sessions[0] && sessions[0].id); });

    function openBookingModal(sessionId) {
      var s = byId(sessionId); if (!s) return;
      activeBookingId = sessionId; pickedSection = null; appliedPromo = null;
      var c = fmtCard(s);
      var hasCredits = credits > 0;
      var upsell = hasCredits ? '' :
        '<div class="lfgw-upsell"><div class="lfgw-upsell-h">Train more, pay less</div>' +
        packages.map(function (p) {
          var anchor = singlePrice * p.sessions_count;
          return '<div class="lfgw-pack"><div class="pinfo"><b>' + p.sessions_count + ' credits</b> · <s>AED ' + anchor.toLocaleString() + '</s> <span class="now">AED ' + p.price_aed + '</span></div>' +
            '<button class="lfgw-pack-buy" data-pkg="' + p.id + '">Get</button></div>';
        }).join('') + '</div>';
      // Promo input only matters for the paid path; hide it when the user is using credits.
      var promoHtml = hasCredits ? '' : promoBlockMarkup();
      modalEl.innerHTML =
        '<div class="lfgw-eyebrow">Reserve your spot</div>' +
        '<div class="lfgw-title">' + c.full + ' · ' + fmtTime(s) + '</div>' +
        '<div class="lfgw-text">' + (hasCredits
          ? 'You have <b>' + credits + ' credit' + (credits === 1 ? '' : 's') + '</b>. Pick a station, then book.'
          : 'Pick a station, then book a single for <b>' + singlePrice + ' AED</b>.') + '</div>' +
        '<div class="lfgw-seclabel">Pick your station</div>' +
        '<div class="lfgw-secgrid">' + s.sections.map(function (sec) {
          return '<div class="lfgw-sec' + (sec.full ? ' full' : '') + '" data-sec="' + sec.label + '">' +
            '<div class="l">' + sec.label + '</div><div class="n">' + (sec.full ? 'Full' : sec.spots_left + ' left') + '</div></div>';
        }).join('') + '</div>' +
        promoHtml +
        '<div class="lfgw-actions" id="lfgwActions"></div>' +
        '<div class="lfgw-terms">' + TERMS_LINE + '</div>' +
        upsell;
      renderActions();
      if (!hasCredits) wirePromoBlock('single', null);
      modalEl.querySelectorAll('.lfgw-sec').forEach(function (t) {
        if (t.classList.contains('full')) return;
        t.addEventListener('click', function () {
          modalEl.querySelectorAll('.lfgw-sec').forEach(function (x) { x.classList.remove('sel'); });
          t.classList.add('sel'); pickedSection = t.getAttribute('data-sec'); renderActions();
        });
      });
      modalEl.querySelectorAll('.lfgw-pack-buy').forEach(function (b) {
        b.addEventListener('click', function () { openPackageModal(Number(b.getAttribute('data-pkg'))); });
      });
      overlay.classList.add('show');
    }

    async function openPackageModal(packageId) {
      if (!loggedIn) {
        var s = await window.lfg.ensureSession();
        if (s) { await markLoggedIn(); }
        else { sessionStorage.setItem('lfg_buy_pkg_after_login', String(packageId)); sessionStorage.setItem('lfg_book_return_path', window.location.pathname); window.location.href = '/login'; return; }
      }
      var pkg = packages.find(function (p) { return p.id === packageId; });
      if (!pkg) return;
      activePackageId = packageId; appliedPromo = null;
      var anchor = singlePrice * pkg.sessions_count;
      var perSession = Math.round(pkg.price_aed / pkg.sessions_count);
      modalEl.innerHTML =
        '<div class="lfgw-eyebrow">Confirm your pack</div>' +
        '<div class="lfgw-title">' + pkg.sessions_count + ' credits · AED ' + pkg.price_aed + '</div>' +
        '<div class="lfgw-text">Valid <b>' + pkg.validity_months + ' month' + (pkg.validity_months === 1 ? '' : 's') + '</b> from purchase. ' +
        '<s>AED ' + anchor.toLocaleString() + '</s> drops to <b>AED ' + pkg.price_aed + '</b> · just <b>AED ' + perSession + '/session</b>.</div>' +
        promoBlockMarkup() +
        '<div class="lfgw-actions" id="lfgwActions"></div>' +
        '<div class="lfgw-terms">' + TERMS_LINE + '</div>';
      renderPackageActions();
      wirePromoBlock('package', packageId);
      overlay.classList.add('show');
    }

    function renderPackageActions() {
      var pkg = packages.find(function (p) { return p.id === activePackageId; });
      if (!pkg) return;
      var price = appliedPromo ? appliedPromo.final_amount : pkg.price_aed;
      document.getElementById('lfgwActions').innerHTML =
        '<button class="lfgw-btn lfgw-btn-ghost" id="lfgwCancel">Cancel</button>' +
        '<button class="lfgw-btn lfgw-btn-primary" id="lfgwPkgGo">Continue · AED ' + price + '</button>';
      document.getElementById('lfgwCancel').addEventListener('click', closeModal);
      document.getElementById('lfgwPkgGo').addEventListener('click', doBuyPackage);
    }

    function renderActions() {
      var dis = pickedSection ? '' : 'disabled';
      var price = appliedPromo ? appliedPromo.final_amount : singlePrice;
      document.getElementById('lfgwActions').innerHTML =
        '<button class="lfgw-btn lfgw-btn-ghost" id="lfgwCancel">Cancel</button>' +
        '<button class="lfgw-btn lfgw-btn-primary" id="lfgwGo" ' + dis + '>' + (credits > 0 ? 'Use 1 credit' : 'Book · AED ' + price) + '</button>';
      document.getElementById('lfgwCancel').addEventListener('click', closeModal);
      document.getElementById('lfgwGo').addEventListener('click', credits > 0 ? doCredit : doBuy);
    }

    async function doCredit() {
      if (!pickedSection) return;
      var btn = document.getElementById('lfgwGo'); btn.disabled = true; btn.textContent = 'Booking…';
      var s = byId(activeBookingId);
      var res = await window.lfg.api('/api/book', { method: 'POST', body: JSON.stringify({ session_id: activeBookingId, section: pickedSection }) });
      if (res.ok && res.data.ok) {
        credits = res.data.credits_left; injectHeader(); setBookBtnLabel();
        showResult('You’re in.', fmtCard(s).full + ' · ' + fmtTime(s) + ' · Station <b>' + res.data.section + '</b><br><br>Credits left: <b>' + credits + '</b>');
        refresh();
      } else { showToast((res.data && res.data.error) || 'Could not book', true); btn.disabled = false; btn.textContent = 'Use 1 credit'; }
    }
    // Embedded Stripe checkout - opens the payment form in a window inside the modal
    // instead of redirecting off-site. Returns true once the form is mounted, false if
    // the session couldn't be created (the caller then restores its own button).
    function destroyEmbedded() { try { if (embeddedCheckout) embeddedCheckout.destroy(); } catch (e) {} embeddedCheckout = null; }

    async function startEmbedded(payload, opts) {
      if (!window.Stripe) { showToast('Payment library not loaded. Refresh and try again.', true); return false; }
      // Swap to the checkout view with a spinner immediately, so the click feels instant.
      // The session create + Stripe load then happen behind the spinner instead of on a
      // frozen button - this is what makes the payment step stop feeling slow.
      modalEl.classList.add('co');
      modalEl.innerHTML =
        '<button class="lfgw-co-back" id="lfgwCoBack" type="button">&larr; Back</button>' +
        '<div class="lfgw-eyebrow">Secure checkout</div>' +
        (opts.title ? '<div class="lfgw-title" style="margin-bottom:14px">' + opts.title + '</div>' : '') +
        '<div id="lfgwCheckout" class="lfgw-checkout-mount"><div class="lfgw-co-spin"><span class="lfgw-spinner"></span>Loading secure checkout…</div></div>';
      overlay.classList.add('show');
      var backedOut = false;
      document.getElementById('lfgwCoBack').addEventListener('click', function () {
        backedOut = true; destroyEmbedded(); modalEl.classList.remove('co');
        if (opts.onBack) opts.onBack(); else closeModal();
      });

      var res = await window.lfg.api('/api/checkout', { method: 'POST', body: JSON.stringify(payload) });
      if (backedOut) return true; // user left while the session was being created
      if (!res.ok || !res.data || !res.data.client_secret || !res.data.publishable_key) {
        showToast((res.data && res.data.error) || 'Checkout failed', true);
        modalEl.classList.remove('co');
        if (opts.onBack) opts.onBack();
        return false;
      }
      var sessionId = res.data.id;
      try {
        var stripe = window.Stripe(res.data.publishable_key);
        embeddedCheckout = await stripe.initEmbeddedCheckout({
          clientSecret: res.data.client_secret,
          onComplete: async function () {
            // Verify server-side that the session is genuinely paid before celebrating.
            var paid = false;
            try {
              var st = await window.lfg.api('/api/checkout?session_id=' + encodeURIComponent(sessionId));
              paid = st.ok && st.data && st.data.payment_status === 'paid';
            } catch (e) {}
            destroyEmbedded(); modalEl.classList.remove('co');
            if (paid && opts.onSuccess) opts.onSuccess();
            else showResult('Payment processing', 'Your payment is being confirmed. It’ll show in <b>My bookings</b> in a moment.');
          }
        });
        if (backedOut) { destroyEmbedded(); return true; }
        var mountEl = document.getElementById('lfgwCheckout');
        if (!mountEl) { destroyEmbedded(); return true; }
        mountEl.innerHTML = ''; // clear the spinner, then drop in the Stripe iframe
        embeddedCheckout.mount('#lfgwCheckout');
      } catch (e) {
        destroyEmbedded(); modalEl.classList.remove('co');
        showToast('Could not load checkout. Try again.', true);
        if (opts.onBack) opts.onBack();
        return false;
      }
      return true;
    }

    async function doBuy() {
      if (!pickedSection) return;
      var btn = document.getElementById('lfgwGo'); btn.disabled = true; btn.textContent = 'Loading…';
      var payload = { kind: 'single', session_id: activeBookingId, section: pickedSection };
      if (appliedPromo) payload.promo_code = appliedPromo.code;
      var s = byId(activeBookingId), sid = activeBookingId;
      var ok = await startEmbedded(payload, {
        title: (s ? fmtCard(s).full + ' · ' + fmtTime(s) : 'Single session') + ' · Station ' + pickedSection,
        onSuccess: function () {
          showResult('Payment confirmed.', 'You’re booked for <b>' + (s ? fmtCard(s).full + ' · ' + fmtTime(s) : 'your Sunday session') + '</b>.<br>Your station is in <b>My bookings</b>.');
          refresh();
        },
        onBack: function () { openBookingModal(sid); }
      });
      if (!ok) { btn.disabled = false; btn.textContent = credits > 0 ? 'Use 1 credit' : 'Book · AED ' + (appliedPromo ? appliedPromo.final_amount : singlePrice); }
    }

    async function doBuyPackage() {
      if (!activePackageId) return;
      var btn = document.getElementById('lfgwPkgGo'); btn.disabled = true; btn.textContent = 'Loading…';
      var pkg = packages.find(function (p) { return p.id === activePackageId; });
      var payload = { kind: 'package', package_id: activePackageId };
      if (appliedPromo) payload.promo_code = appliedPromo.code;
      var pid = activePackageId;
      var ok = await startEmbedded(payload, {
        title: (pkg ? pkg.sessions_count + ' credits · AED ' + (appliedPromo ? appliedPromo.final_amount : pkg.price_aed) : 'Package'),
        onSuccess: function () {
          showResult('Payment confirmed.', 'Your credits have been added - pick a Sunday to book.', { text: 'Book now', href: '#bootcamps' });
          refresh();
        },
        onBack: function () { openPackageModal(pid); }
      });
      if (!ok) { renderPackageActions(); }
    }

    // The offers strip clicks straight into the new confirm-modal so the user can
    // see the pack summary + apply a promo code before being sent to Stripe.
    function buyPackage(packageId) { openPackageModal(packageId); }

    function showResult(title, html, primary, isError) {
      primary = primary || { text: 'My bookings', href: '/account' };
      var icon = isError ? '<div class="lfgw-error-icon">&#10005;</div>' : '<div class="lfgw-success-icon">&#10003;</div>';
      var primaryHtml = primary.href
        ? '<a class="lfgw-btn lfgw-btn-primary" href="' + primary.href + '">' + primary.text + '</a>'
        : '<button class="lfgw-btn lfgw-btn-primary" id="lfgwPrimary">' + primary.text + '</button>';
      modalEl.innerHTML = icon +
        '<div class="lfgw-title">' + title + '</div>' +
        '<div class="lfgw-success-meta" style="margin-bottom:22px;">' + html + '</div>' +
        '<div class="lfgw-actions"><button class="lfgw-btn lfgw-btn-ghost" id="lfgwDone">Close</button>' + primaryHtml + '</div>';
      document.getElementById('lfgwDone').addEventListener('click', closeModal);
      if (!primary.href && primary.onClick) document.getElementById('lfgwPrimary').addEventListener('click', primary.onClick);
      overlay.classList.add('show');
    }

    // Post-Stripe return confirmation.
    function handleReturn() {
      var q = new URLSearchParams(window.location.search);
      if (q.has('booked')) {
        var s = byId(q.get('booked'));
        var when = s ? fmtCard(s).full + ' · ' + fmtTime(s) : 'your Sunday session';
        showResult('Payment confirmed.', 'You’re booked for <b>' + when + '</b>.<br>Your station is in <b>My bookings</b>.');
        cleanUrl();
      } else if (q.has('credited')) {
        showResult('Payment confirmed.', 'Your credits have been added - you now have <b>' + credits + ' credit' + (credits === 1 ? '' : 's') + '</b>.<br>Pick a Sunday to book.',
          { text: 'Book now', href: '#bootcamps' });
        cleanUrl();
      } else if (q.has('canceled')) {
        var cv = q.get('canceled');
        var canRetry = byId(cv);
        var primary = canRetry
          ? { text: 'Try again', onClick: function () { closeModal(); openBookingModal(cv); } }
          : { text: 'Browse Sundays', href: '#bootcamps' };
        showResult('Payment not completed', 'No charge was made and your spot isn’t booked yet. If your card was declined, you can try a different card.', primary, true);
        cleanUrl();
      }
    }
    function cleanUrl() { history.replaceState(null, '', window.location.pathname + '#bootcamps'); }

    // Promote to the logged-in state (used after a tap-time re-verify finds a session).
    async function markLoggedIn() {
      loggedIn = true;
      try { var me = await window.lfg.api('/api/me'); credits = (me.ok && me.data.sessions_remaining) || 0; } catch (e) {}
      setBookBtnLabel();
      injectHeader();
    }

    // Self-correct if the load-time auth read raced the session restore. When the
    // client finishes restoring (INITIAL_SESSION) or refreshes the token, flip the
    // flag so logged-in members never get stuck looking logged out.
    if (window.lfg && window.lfg.sb && window.lfg.sb.auth) {
      window.lfg.sb.auth.onAuthStateChange(function (evt, session) {
        var nowLogged = !!session;
        if (nowLogged && !loggedIn) { markLoggedIn(); }
        else if (!nowLogged && loggedIn) { loggedIn = false; credits = 0; setBookBtnLabel(); injectHeader(); }
      });
    }

    refresh().then(function () {
      handleReturn();
      var pending = sessionStorage.getItem('lfg_book_after_login');
      if (pending && loggedIn) {
        sessionStorage.removeItem('lfg_book_after_login');
        if (byId(pending)) openBookingModal(pending);
      }
      var pendingPkg = sessionStorage.getItem('lfg_buy_pkg_after_login');
      if (pendingPkg && loggedIn) {
        sessionStorage.removeItem('lfg_buy_pkg_after_login');
        var pid = Number(pendingPkg);
        if (packages.some(function (p) { return p.id === pid; })) openPackageModal(pid);
      }
    });
  });
})();
