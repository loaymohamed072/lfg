/* ============================================================
   LFG Bootcamp System - shared Supabase client + auth helpers
   Publishable key only (safe in browser). All DATA access goes
   through serverless /api/* (service role), never direct here.
   ============================================================ */
(function () {
  var LFG_SUPABASE_URL = 'https://mqhrjliqjxcxtzorapiy.supabase.co';
  var LFG_SUPABASE_KEY = 'sb_publishable_WWgNbaLzvfe5PRGUAl5xqQ_aLAcN3d_';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[LFG] supabase-js not loaded before lfg-supabase.js');
    return;
  }

  // Capture whether we arrived from an auth redirect BEFORE createClient runs, because
  // detectSessionInUrl strips the #access_token from the URL as it processes it. Reading
  // the hash later (e.g. in getSettledSession) can race and find it already cleared,
  // which made the page bounce to /login and loop - seen on Chrome mobile, where the
  // timing differs from Safari. This snapshot is the source of truth for "was there a token".
  var AUTH_REDIRECT = /(?:[#&?])(access_token|refresh_token|code)=/.test(window.location.hash + window.location.search);

  // Implicit flow: our sign-in links are generated server-side (admin generateLink for
  // both the welcome email and /api/send-login-link), so the verify endpoint returns
  // the session as #access_token in the URL hash. PKCE would ignore that hash (no
  // client-side code_verifier exists for a server link), which is why magic links
  // landed on /login instead of signing the member in. Implicit consumes the hash.
  var sb = window.supabase.createClient(LFG_SUPABASE_URL, LFG_SUPABASE_KEY, {
    auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, flowType: 'implicit' }
  });

  var origin = window.location.origin;
  var _restoreOnce = null; // in-flight/last remember-me restore for this page load

  window.lfg = {
    sb: sb,

    // True when running inside an app's embedded webview (Instagram, Facebook,
    // TikTok, Snapchat, LinkedIn, Android WebView). Google blocks OAuth there
    // (403 disallowed_useragent), so login UIs should steer these users to the
    // email link instead. WhatsApp/Telegram on iOS use SFSafariViewController and
    // Android Custom Tabs, which Google allows - they don't match this list.
    isEmbeddedBrowser() {
      var ua = navigator.userAgent || '';
      return /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|LinkedInApp|; wv\)/i.test(ua);
    },

    async getSession() {
      var res = await sb.auth.getSession();
      return res.data ? res.data.session : null;
    },

    // Like getSession but retries briefly. On a standalone PWA cold start (iOS
    // home-screen app especially), the very first getSession() can read null for
    // a member who IS logged in, because the client hasn't finished restoring the
    // stored session from localStorage yet. A single read then bounced them to
    // /login on tap ("logged in but asked to sign in"). This waits that race out.
    async ensureSession(retries, gapMs) {
      retries = retries || 5; gapMs = gapMs || 250;
      for (var i = 0; i < retries; i++) {
        var s = await this.getSession();
        if (s) return s;
        if (i < retries - 1) await new Promise(function (r) { setTimeout(r, gapMs); });
      }
      // Nothing in local storage. Safari clears it after 7 quiet days (and a member
      // who runs fortnightly hits that), so before calling anyone logged out, try
      // the httpOnly remember-me cookie, which ITP does not touch.
      return await this.restoreFromCookie();
    },

    // Like getSession, but if we just returned from an auth redirect (token in the
    // URL hash/query), wait for Supabase to finish processing it before resolving.
    // Without this, a page can read "no session" a beat too early and bounce the
    // user back to login - the bug behind "I had to scan the QR again".
    async getSettledSession() {
      var s = await this.getSession();
      if (s) return s;
      // No auth redirect in play: this is a normal/cold page load. The first read can
      // still race the PWA's session restore, so retry briefly before giving up. This
      // is what keeps logged-in members from seeing "sign in" on the QR check-in pages.
      if (!AUTH_REDIRECT) return await this.ensureSession();
      var self = this;
      var settled = await new Promise(function (resolve) {
        var done = false, sub = null;
        function finish(val) { if (done) return; done = true; try { if (sub && sub.data && sub.data.subscription) sub.data.subscription.unsubscribe(); } catch (e) {} resolve(val); }
        sub = sb.auth.onAuthStateChange(function (_evt, sess) { if (sess) finish(sess); });
        // Poll a couple of times too, in case the state-change fired before we subscribed.
        var tries = 0;
        var iv = setInterval(async function () { var ss = await self.getSession(); if (ss) { clearInterval(iv); finish(ss); } else if (++tries > 8) { clearInterval(iv); } }, 500);
        setTimeout(async function () { clearInterval(iv); finish(await self.getSession()); }, 5000);
      });
      // A dead or already-consumed magic link lands here. The member may still be
      // a known device, so fall back to the cookie rather than the login screen.
      return settled || await this.restoreFromCookie();
    },

    // Silent sign-in from the httpOnly remember-me cookie. Safari clears
    // localStorage (and the session in it) after 7 days without a visit; the
    // server-set cookie survives, so we can mint a fresh session without the
    // member ever seeing the login page. Returns the session or null.
    async restoreFromCookie() {
      // One attempt per page load, shared by every caller. Without this, a page
      // that checks auth in two places would fire two restores and race them.
      if (_restoreOnce) return _restoreOnce;
      _restoreOnce = this._doRestore();
      return _restoreOnce;
    },

    async _doRestore() {
      try {
        var res = await fetch('/api/session-restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restore' })
        });
        if (!res.ok) return null;
        var t = await res.json();
        if (!t || !t.access_token || !t.refresh_token) return null;
        var set = await sb.auth.setSession({ access_token: t.access_token, refresh_token: t.refresh_token });
        return (set.data && set.data.session) || null;
      } catch (e) { return null; }
    },

    // Give this device a remember-me cookie (idempotent, throttled to once/day).
    // Called whenever a page confirms a live session, so every logged-in device
    // ends up covered without any UI.
    async rememberDevice(session) {
      try {
        var last = Number(localStorage.getItem('lfg_rm_ts') || 0);
        if (Date.now() - last < 86400000) return;
        localStorage.setItem('lfg_rm_ts', String(Date.now()));
        await fetch('/api/session-restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
          body: JSON.stringify({ action: 'register' })
        });
      } catch (e) { /* best effort */ }
    },

    // Redirect to login if not authenticated. Returns the session otherwise.
    // getSettledSession waits out the magic-link redirect; ensureSession then waits
    // out the PWA cold-start restore race; restoreFromCookie survives Safari
    // evicting localStorage. A member only lands on /login if all three miss.
    async requireAuth(loginPath) {
      // getSettledSession waits out the magic-link redirect, then falls through to
      // ensureSession (PWA cold-start race) and finally the remember-me cookie.
      var session = await this.getSettledSession();
      if (!session) { window.location.replace(loginPath || '/login'); return null; }
      return session;
    },

    async signInGoogle(redirectPath) {
      return sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: origin + (redirectPath || '/account') }
      });
    },

    async signInMagicLink(email, redirectPath) {
      // Send the sign-in link through our own branded Resend email (via the server)
      // instead of Supabase's default magic-link email. The server generates the
      // Supabase magic link and delivers it on-brand from our verified domain.
      try {
        var res = await fetch('/api/send-login-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, next: redirectPath || '/account' })
        });
        var data = null; try { data = await res.json(); } catch (e) {}
        if (!res.ok) return { error: { message: (data && data.error) || 'Could not send the link. Try again.' } };
        return { data: data || { ok: true }, error: null };
      } catch (e) {
        return { error: { message: 'Network error. Try again.' } };
      }
    },

    async signOut(loginPath) {
      // scope:'local' signs out THIS device only. The default ('global') revoked
      // every session the member had - signing out on a laptop silently killed
      // their phone's PWA session, which then asked them to log in again.
      try { localStorage.removeItem('lfg_rm_ts'); } catch (e) {}
      await fetch('/api/session-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forget' })
      }).catch(function () {});
      await sb.auth.signOut({ scope: 'local' });
      window.location.replace(loginPath || '/login');
    },

    // Authenticated fetch to a serverless endpoint (adds Bearer token).
    async api(path, options) {
      options = options || {};
      var session = await this.getSession();
      var headers = Object.assign(
        { 'Content-Type': 'application/json' },
        options.headers || {}
      );
      if (session && session.access_token) headers.Authorization = 'Bearer ' + session.access_token;
      var res = await fetch(path, Object.assign({}, options, { headers: headers }));
      var body = null;
      try { body = await res.json(); } catch (e) { /* non-json */ }
      return { ok: res.ok, status: res.status, data: body };
    }
  };

  // Every page that ends up with a session registers this device for remember-me.
  // Previously only /account did (it was the sole caller of requireAuth), so a member
  // who only ever used the QR check-in page never got a cookie and got logged out
  // the moment Safari cleared local storage. rememberDevice is throttled to once a
  // day per device, so firing this on every page load is cheap.
  try {
    sb.auth.onAuthStateChange(function (evt, sess) {
      if (!sess) return;
      if (evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED' || evt === 'INITIAL_SESSION') {
        window.lfg.rememberDevice(sess);
      }
    });
  } catch (e) { /* older browser - remember-me just registers on /account as before */ }

  // Capture the current URL whenever a user clicks a link that goes to /account, so the
  // account page can offer a "← Back" button that returns to exactly where they came
  // from (including the hash so e.g. /bootcamp.html#bootcamps lands on the right section).
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var raw = a.getAttribute('href') || '';
    // Match /account, /account?..., /account#... - but not unrelated paths.
    if (raw === '/account' || raw.indexOf('/account?') === 0 || raw.indexOf('/account#') === 0) {
      var here = window.location.pathname + window.location.search + window.location.hash;
      if (here && here !== '/account' && here.indexOf('/account') !== 0) {
        try { sessionStorage.setItem('lfg_acct_back', here); } catch (err) { /* private mode */ }
      }
    }
  }, true);
})();
