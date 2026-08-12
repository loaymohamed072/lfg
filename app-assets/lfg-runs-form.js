// LFG Runs registration form - multi-step wizard, UTM capture, submit handler.
// Posts to /api/run-register and swaps in a success state with a bootcamp upsell.
(function () {
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    var root = document.getElementById('lfgrf-root');
    if (!root) return;

    var form = document.getElementById('lfgrf-form');
    var steps = Array.prototype.slice.call(form.querySelectorAll('.lfgrf-step'));
    var progress = document.getElementById('lfgrf-progress');
    var backBtn = document.getElementById('lfgrf-back');
    var nextBtn = document.getElementById('lfgrf-next');
    var submitBtn = document.getElementById('lfgrf-submit');
    var errorEl = document.getElementById('lfgrf-error');
    var successEl = document.getElementById('lfgrf-success');

    var current = 0;

    // Populate the DOB dropdowns once. Day stays 1-31 (server validates real calendar
    // days, so e.g. Feb 30 is rejected in dobIso() below). Year range: 1925 → today.
    (function fillDobPickers() {
      var dEl = document.getElementById('lfgrf-dob-d');
      var yEl = document.getElementById('lfgrf-dob-y');
      if (!dEl || !yEl) return;
      for (var d = 1; d <= 31; d++) {
        var o = document.createElement('option'); o.value = String(d); o.textContent = String(d);
        dEl.appendChild(o);
      }
      var maxYear = new Date().getFullYear();
      for (var y = maxYear; y >= 1925; y--) {
        var o2 = document.createElement('option'); o2.value = String(y); o2.textContent = String(y);
        yEl.appendChild(o2);
      }
    })();

    // Compose a YYYY-MM-DD string from the three pickers and verify the day actually
    // exists in that month (rejects Feb 30 etc). Returns null when the date is bad.
    function dobIso() {
      var d = Number(document.getElementById('lfgrf-dob-d').value);
      var m = Number(document.getElementById('lfgrf-dob-m').value);
      var y = Number(document.getElementById('lfgrf-dob-y').value);
      if (!d || !m || !y) return null;
      var dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
      var mm = m < 10 ? '0' + m : '' + m;
      var dd = d < 10 ? '0' + d : '' + d;
      return y + '-' + mm + '-' + dd;
    }

    function showError(msg) {
      errorEl.textContent = msg; errorEl.hidden = false;
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function clearError() { errorEl.textContent = ''; errorEl.hidden = true; }

    function setStep(i) {
      current = Math.max(0, Math.min(steps.length - 1, i));
      steps.forEach(function (s, idx) { s.classList.toggle('active', idx === current); });
      Array.prototype.slice.call(progress.children).forEach(function (dot, idx) {
        dot.classList.toggle('active', idx === current);
        dot.classList.toggle('done', idx < current);
      });
      backBtn.hidden = current === 0;
      nextBtn.hidden = current === steps.length - 1;
      submitBtn.hidden = current !== steps.length - 1;
      clearError();
      // Focus the first input in the new step so keyboards / screen readers track.
      var first = steps[current].querySelector('input,select,textarea');
      if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 40);
    }

    // Instagram rule: mandatory for a NEW account, optional when a profile is
    // already on file. Checked when the email field loses focus; fails open so a
    // hiccup in the check can never block a registration.
    var igRequired = true;
    (function () {
      var emailEl = document.getElementById('lfgrf-email');
      if (!emailEl) return;
      emailEl.addEventListener('blur', function () {
        var email = emailEl.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
        fetch('/api/profile-check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          if (d) igRequired = !!d.instagram_required;
        }).catch(function () {});
      });
    })();

    function validateStep(i) {
      if (i === 0) {
        if (!document.getElementById('lfgrf-first').value.trim()) return 'First name is required.';
        if (!document.getElementById('lfgrf-last').value.trim()) return 'Last name is required.';
        var email = document.getElementById('lfgrf-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email.';
        var ph = document.getElementById('lfgrf-phone').value.trim().replace(/[^\d]/g, '');
        if (ph.length < 7) return 'Enter a valid WhatsApp number.';
      }
      if (i === 1) {
        if (!form.querySelector('input[name="level"]:checked')) return 'Pick your level.';
        var iso = dobIso();
        if (!iso) return 'Pick a valid date of birth.';
        if (!document.getElementById('lfgrf-nationality').value) return 'Pick your nationality.';
        if (!document.getElementById('lfgrf-tenure').value) return 'Tell us how long you\'ve been in the UAE.';
      }
      if (i === 2) {
        if (!document.getElementById('lfgrf-occupation').value) return 'Pick what you\'re currently doing.';
        if (document.getElementById('lfgrf-occupation').value === 'working_pro' && !document.getElementById('lfgrf-occupation-detail').value.trim()) {
          return 'Tell us what you do (your role or field).';
        }
        var igv = document.getElementById('lfgrf-ig').value.trim();
        if (igRequired && !igv) return 'Add your Instagram handle so the team knows who\'s who.';
        if (igv && !/^@?[A-Za-z0-9._]{1,30}$/.test(igv)) return 'That Instagram handle doesn\'t look right.';
        // Interests is optional now.
      }
      return null;
    }

    nextBtn.addEventListener('click', function () {
      var err = validateStep(current);
      if (err) { showError(err); return; }
      setStep(current + 1);
    });
    backBtn.addEventListener('click', function () { setStep(current - 1); });

    // Level radio cards - manual styling because the native radios are visually hidden.
    document.querySelectorAll('#lfgrf-level-group .lfgrf-radio').forEach(function (card) {
      card.addEventListener('click', function () {
        document.querySelectorAll('#lfgrf-level-group .lfgrf-radio').forEach(function (c) { c.classList.remove('sel'); });
        card.classList.add('sel');
        card.querySelector('input').checked = true;
      });
    });

    // Occupation: reveal the free-text "what do you do?" field only for working pros.
    // Owner wants the actual profession captured for this segment.
    var occSel = document.getElementById('lfgrf-occupation');
    function toggleOccDetail() {
      var row = document.getElementById('lfgrf-occupation-detail-row');
      if (!row || !occSel) return;
      var show = occSel.value === 'working_pro';
      row.hidden = !show;
      if (!show) { var di = document.getElementById('lfgrf-occupation-detail'); if (di) di.value = ''; }
    }
    if (occSel) occSel.addEventListener('change', toggleOccDetail);

    // Capture UTM + referrer + landing from the URL once on load.
    function param(name) { try { return new URL(window.location.href).searchParams.get(name); } catch (e) { return null; } }
    var captured = {
      utm_source: param('utm_source'),
      utm_medium: param('utm_medium'),
      utm_campaign: param('utm_campaign'),
      utm_content: param('utm_content'),
      referrer: document.referrer || null,
      landing_page: window.location.pathname + window.location.search
    };

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = validateStep(current);
      if (err) { showError(err); return; }

      submitBtn.disabled = true; submitBtn.textContent = 'Sending…';

      var cc = document.getElementById('lfgrf-cc').value;
      var phoneRaw = document.getElementById('lfgrf-phone').value.replace(/[^\d]/g, '');
      // Trim any leading 0 - common with UAE numbers like 050 123 4567.
      if (phoneRaw.charAt(0) === '0') phoneRaw = phoneRaw.slice(1);
      var whatsapp = cc + phoneRaw;

      var payload = {
        source: 'homepage',
        first_name: document.getElementById('lfgrf-first').value.trim(),
        last_name: document.getElementById('lfgrf-last').value.trim(),
        email: document.getElementById('lfgrf-email').value.trim().toLowerCase(),
        whatsapp: whatsapp,
        level: (form.querySelector('input[name="level"]:checked') || {}).value || null,
        date_of_birth: dobIso(),
        nationality: document.getElementById('lfgrf-nationality').value || null,
        uae_tenure: document.getElementById('lfgrf-tenure').value || null,
        occupation: document.getElementById('lfgrf-occupation').value || null,
        occupation_detail: document.getElementById('lfgrf-occupation').value === 'working_pro' ? (document.getElementById('lfgrf-occupation-detail').value.trim() || null) : null,
        instagram_handle: document.getElementById('lfgrf-ig').value.trim() || null,
        interests: document.getElementById('lfgrf-interests').value.trim() || null,
        hear_source: document.getElementById('lfgrf-hear').value || null,
        consent_marketing: document.getElementById('lfgrf-consent').checked,
        website_url: document.getElementById('lfgrf-hp').value, // honeypot
        utm_source: captured.utm_source,
        utm_medium: captured.utm_medium,
        utm_campaign: captured.utm_campaign,
        utm_content: captured.utm_content,
        referrer: captured.referrer,
        landing_page: captured.landing_page
      };

      // Filling the form = coming to the next run. Attach the run date so the server
      // records an RSVP and the owner's headcount includes form sign-ups.
      var nr = await getNextRun();
      if (nr) { payload.run_date = nr.run_date; payload.run_type = nr.run_type; }

      try {
        var res = await fetch('/api/run-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = null; try { data = await res.json(); } catch (_) {}
        if (!res.ok || !data || !data.ok) {
          showError((data && data.error) || 'Could not save your registration. Try again in a moment.');
          submitBtn.disabled = false; submitBtn.textContent = 'Submit';
          return;
        }
        // Success - swap the form for the celebratory state with the bootcamp upsell.
        form.hidden = true;
        progress.hidden = true;
        document.getElementById('lfgrf-success-name').textContent = data.first_name || payload.first_name;
        successEl.hidden = false;
        successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e2) {
        showError('Network error - please try again.');
        submitBtn.disabled = false; submitBtn.textContent = 'Submit';
      }
    });

    setStep(0);

    // Logged-in members don't need to re-enter everything - swap the wizard for a
    // one-tap "are you joining the next run?" RSVP. Fire-and-forget; on any failure
    // the full form stays in place.
    setupRsvp();

    async function setupRsvp() {
      try {
        if (!window.lfg || !window.lfg.getSession) return;
        var session = await window.lfg.getSession();
        if (!session || !session.user) return;

        // Gate: members whose run profile is incomplete (Google / magic-link sign-ups who never
        // filled the form) keep the full form, pre-filled with what we know, until they complete
        // it. Only members with a complete profile get the one-tap RSVP below.
        try {
          var prof = await window.lfg.api('/api/run-profile');
          var pdata = (prof && prof.data) || {};
          if (prof && prof.ok && pdata.complete === false) {
            prefillRunForm(pdata.profile || {});
            var lbl0 = document.querySelector('#register-form .activity-form-label');
            if (lbl0) lbl0.textContent = 'One-time details to join LFG runs';
            return; // leave the wizard in place so they fill their details
          }
        } catch (e) { /* on any error, fall through to the default behaviour */ }

        // Next run(s) from the admin config (weekly recurring Wednesday + optional Saturday).
        var cfg = null;
        try {
          var c = await window.lfg.sb.from('event_config')
            .select('event_datetime,location,saturday_datetime,saturday_location,saturday_enabled')
            .eq('id', 1).maybeSingle();
          cfg = c && c.data;
        } catch (e) { return; }
        if (!cfg) return;

        var runs = [];
        var wed = advanceIfPast(cfg.event_datetime);
        if (wed) runs.push({ when: wed, location: cfg.location || '', type: weekdayType(wed) });
        if (cfg.saturday_enabled && cfg.saturday_datetime) {
          var sat = advanceIfPast(cfg.saturday_datetime);
          if (sat) runs.push({ when: sat, location: cfg.saturday_location || '', type: weekdayType(sat) });
        }
        if (!runs.length) return;
        runs.sort(function (a, b) { return a.when - b.when; });
        var next = runs[0];
        var runDate = dubaiYMD(next.when);

        var fullName = (session.user.user_metadata && session.user.user_metadata.full_name) || (session.user.email || '').split('@')[0] || 'there';
        var firstName = String(fullName).trim().split(/\s+/)[0];

        // Hide the wizard, drop in the RSVP card.
        var formEl = document.getElementById('lfgrf-form');
        var progEl = document.getElementById('lfgrf-progress');
        if (formEl) formEl.hidden = true;
        if (progEl) progEl.style.display = 'none';
        var labelEl = document.querySelector('#register-form .activity-form-label');
        if (labelEl) labelEl.textContent = 'Joining the next run?';

        var dayStr = next.when.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
        var timeStr = next.when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
        var locStr = next.location ? (' · ' + next.location) : '';

        var box = document.createElement('div');
        box.className = 'lfgrf-rsvp';
        box.innerHTML =
          '<h3 class="lfgrf-h">Hey <em>' + escapeHtml(firstName) + '</em></h3>' +
          '<p class="lfgrf-sub">Are you joining the next run?</p>' +
          '<div class="lfgrf-rsvp-run">' + escapeHtml(dayStr + ' · ' + timeStr + locStr) + '</div>' +
          '<div class="lfgrf-rsvp-actions">' +
            '<button type="button" class="lfgrf-rsvp-btn yes" data-v="yes">Yes, I&#39;m in</button>' +
            '<button type="button" class="lfgrf-rsvp-btn no" data-v="no">Can&#39;t make it</button>' +
          '</div>' +
          '<div class="lfgrf-rsvp-count" id="lfgrf-rsvp-count"></div>';
        root.appendChild(box);

        var countEl = box.querySelector('#lfgrf-rsvp-count');
        function paintCount(n, mine) {
          // Headcount intentionally not shown to members (owner request).
          if (mine === 'yes') countEl.innerHTML = '<b>You’re in.</b> See you there.';
          else if (mine === 'no') countEl.innerHTML = 'No worries, catch the next one.';
          else countEl.innerHTML = '';
        }
        function setSel(v) {
          box.querySelectorAll('.lfgrf-rsvp-btn').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-v') === v); });
        }

        var status = await window.lfg.api('/api/run-rsvp?run_date=' + encodeURIComponent(runDate));
        var cur = (status && status.data) || { count: 0, my_status: null };
        if (cur.my_status) setSel(cur.my_status);
        paintCount(cur.count || 0, cur.my_status);

        box.querySelectorAll('.lfgrf-rsvp-btn').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var v = btn.getAttribute('data-v');
            box.querySelectorAll('.lfgrf-rsvp-btn').forEach(function (b) { b.disabled = true; });
            var r = await window.lfg.api('/api/run-rsvp', { method: 'POST', body: JSON.stringify({ run_date: runDate, run_type: next.type, attending: v === 'yes' }) });
            box.querySelectorAll('.lfgrf-rsvp-btn').forEach(function (b) { b.disabled = false; });
            if (r.ok && r.data && r.data.ok) { setSel(v); paintCount(r.data.count, v); }
            else { countEl.textContent = (r.data && r.data.error) || 'Could not save - try again.'; }
          });
        });
      } catch (e) { /* leave the full form in place on any error */ }
    }

    // Pre-fill the sign-up wizard for a logged-in member with an incomplete profile, using
    // whatever we already have (name/email from Google, plus any partial run-form data). The
    // email is locked to their account so the new record links back to them by email.
    function prefillRunForm(p) {
      function setVal(id, v) { var el = document.getElementById(id); if (el && v && !el.value) el.value = v; }
      function setSelect(id, v) { var el = document.getElementById(id); if (el && v) el.value = String(v); }
      setVal('lfgrf-first', p.first_name);
      setVal('lfgrf-last', p.last_name);
      var em = document.getElementById('lfgrf-email');
      if (em && p.email) { em.value = p.email; em.readOnly = true; em.style.opacity = '0.7'; }
      setVal('lfgrf-ig', p.instagram_handle);
      setSelect('lfgrf-nationality', p.nationality);
      setSelect('lfgrf-tenure', p.uae_tenure);
      setSelect('lfgrf-occupation', p.occupation);
      setVal('lfgrf-occupation-detail', p.occupation_detail);
      toggleOccDetail();
      if (p.level) {
        var lr = document.querySelector('#lfgrf-level-group input[value="' + p.level + '"]');
        if (lr) {
          lr.checked = true;
          var card = lr.closest('.lfgrf-radio');
          if (card) { document.querySelectorAll('#lfgrf-level-group .lfgrf-radio').forEach(function (c) { c.classList.remove('sel'); }); card.classList.add('sel'); }
        }
      }
      if (p.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth)) {
        var pr = p.date_of_birth.split('-');
        setSelect('lfgrf-dob-y', Number(pr[0]));
        setSelect('lfgrf-dob-m', Number(pr[1]));
        setSelect('lfgrf-dob-d', Number(pr[2]));
      }
    }

    // Next run (date + type) from config, cached. Used by the form submit to record an
    // RSVP for the next run. Returns null if config/schedule isn't available.
    var _nextRunCache;
    async function getNextRun() {
      if (_nextRunCache !== undefined) return _nextRunCache;
      _nextRunCache = null;
      try {
        if (!window.lfg || !window.lfg.sb) return null;
        var c = await window.lfg.sb.from('event_config')
          .select('event_datetime,saturday_datetime,saturday_enabled').eq('id', 1).maybeSingle();
        var cfg = c && c.data; if (!cfg) return null;
        var runs = [];
        var wed = advanceIfPast(cfg.event_datetime); if (wed) runs.push(wed);
        if (cfg.saturday_enabled && cfg.saturday_datetime) { var sat = advanceIfPast(cfg.saturday_datetime); if (sat) runs.push(sat); }
        if (!runs.length) return null;
        runs.sort(function (a, b) { return a - b; });
        _nextRunCache = { run_date: dubaiYMD(runs[0]), run_type: weekdayType(runs[0]) };
        return _nextRunCache;
      } catch (e) { return null; }
    }

    function advanceIfPast(dtStr) {
      if (!dtStr) return null;
      var t = new Date(dtStr); if (isNaN(t.getTime())) return null;
      var now = new Date();
      var guard = 0;
      // 1-hour grace: a run stays "current" until 1h after start (matches the pay page).
      while (t.getTime() + 3600000 < now.getTime() && guard++ < 520) t = new Date(t.getTime() + 7 * 86400000);
      return t;
    }
    function dubaiYMD(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    function weekdayType(d) { return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dubai' }).toLowerCase(); }
    function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  });
})();
