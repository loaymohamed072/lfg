/* ============================================================
   LFG - Sponsor a bootcamp ticket (homepage section #give)

   Public on purpose. The buyer is usually a guest, not a member,
   so nothing here asks for an account or creates one: Stripe
   collects the name and email, and /api/checkout accepts
   kind:'sponsor' unauthenticated. Tickets land in a pool that the
   coaches hand out by name in Admin -> Sponsored.
   ============================================================ */
(function () {
  var root = document.getElementById('give');
  if (!root || !window.lfg) return;

  var MIN = 1, MAX = 50;
  var qty = 2;
  var price = null;          // AED per ticket, from /api/sponsor
  var embedded = null;       // live Stripe embedded checkout, if any
  var busy = false;

  var el = {
    qty:      document.getElementById('give-qty'),
    total:    document.getElementById('give-total'),
    minus:    document.getElementById('give-minus'),
    plus:     document.getElementById('give-plus'),
    note:     document.getElementById('give-note'),
    go:       document.getElementById('give-go'),
    err:      document.getElementById('give-err'),
    count:    document.getElementById('give-count'),
    form:     document.getElementById('give-form'),
    checkout: document.getElementById('give-checkout'),
    mount:    document.getElementById('give-mount'),
    back:     document.getElementById('give-back'),
    done:     document.getElementById('give-done'),
    doneBody: document.getElementById('give-done-body')
  };
  for (var k in el) { if (!el[k]) return; }

  function money(n) { return 'AED ' + Number(n).toLocaleString('en-AE'); }

  function paintTotal() {
    el.qty.textContent = String(qty);
    el.total.textContent = price == null
      ? 'Loading price…'
      : money(price * qty) + ' · ' + money(price) + ' each';
    el.minus.disabled = busy || qty <= MIN;
    el.plus.disabled  = busy || qty >= MAX;
  }

  function fail(msg) {
    el.err.textContent = msg;
    el.err.hidden = false;
  }
  function clearFail() { el.err.hidden = true; el.err.textContent = ''; }

  function setBusy(on, label) {
    busy = on;
    el.go.disabled = on;
    el.go.setAttribute('aria-busy', on ? 'true' : 'false');
    el.go.textContent = on ? (label || 'Loading…') : 'Sponsor tickets';
    paintTotal();
  }

  function destroyEmbedded() {
    if (!embedded) return;
    try { embedded.destroy(); } catch (e) {}
    embedded = null;
  }

  function showForm() {
    destroyEmbedded();
    el.checkout.hidden = true;
    el.done.hidden = true;
    el.form.hidden = false;
    setBusy(false);
  }

  function showDone(paid) {
    destroyEmbedded();
    el.form.hidden = true;
    el.checkout.hidden = true;
    el.done.hidden = false;
    el.doneBody.textContent = paid
      ? qty + (qty === 1 ? ' ticket is' : ' tickets are') + ' with the coaches. They go out by name at the next bootcamps, and we will email you nothing else.'
      : 'Your payment is being confirmed. If anything looks wrong, message us on WhatsApp and we will check it.';
    load(); // refresh the community counter
  }

  async function load() {
    try {
      var res = await window.lfg.api('/api/sponsor');
      if (!res.ok || !res.data) return;
      price = Number(res.data.price_aed);
      var total = Number(res.data.community_total || 0);
      if (total > 0) {
        el.count.innerHTML = '<b>' + total + '</b> ticket' + (total === 1 ? '' : 's') + ' paid forward so far';
        el.count.hidden = false;
      }
      paintTotal();
    } catch (e) { /* the card still works; the price shows after checkout opens */ }
  }

  el.minus.addEventListener('click', function () { if (qty > MIN) { qty--; clearFail(); paintTotal(); } });
  el.plus.addEventListener('click',  function () { if (qty < MAX) { qty++; clearFail(); paintTotal(); } });

  el.back.addEventListener('click', function () { clearFail(); showForm(); });

  el.go.addEventListener('click', async function () {
    if (busy) return;
    clearFail();
    setBusy(true, 'Opening…');

    var note = (el.note.value || '').trim().slice(0, 200);
    var res;
    try {
      res = await window.lfg.api('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({ kind: 'sponsor', qty: qty, note: note })
      });
    } catch (e) {
      setBusy(false);
      fail('Could not reach checkout. Check your connection and try again, or message us on WhatsApp.');
      return;
    }

    if (!res.ok || !res.data || !res.data.client_secret || !res.data.publishable_key) {
      setBusy(false);
      fail((res.data && res.data.error) || 'Could not open checkout. Try again, or message us on WhatsApp.');
      return;
    }

    var sessionId = res.data.id;
    el.form.hidden = true;
    el.checkout.hidden = false;
    el.mount.innerHTML = '';

    try {
      var stripe = window.Stripe(res.data.publishable_key);
      embedded = await stripe.initEmbeddedCheckout({
        clientSecret: res.data.client_secret,
        onComplete: async function () {
          // onComplete fires client-side, so confirm server-side before thanking them.
          var paid = false;
          try {
            var st = await window.lfg.api('/api/checkout?session_id=' + encodeURIComponent(sessionId));
            paid = st.ok && st.data && st.data.payment_status === 'paid';
          } catch (e) {}
          showDone(paid);
        }
      });
      embedded.mount('#give-mount');
      setBusy(false);
    } catch (e) {
      destroyEmbedded();
      showForm();
      fail('Could not load the payment form. Try again, or message us on WhatsApp.');
    }
  });

  paintTotal();
  load();
})();
