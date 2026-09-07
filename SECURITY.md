## Verdict: FLAG
**Date:** 2026-08-10 (session J - padel go-live prep: play time, public board, portal points, headers)
**Scope:** new `api/padel-leaderboard.js`; `api/padel-status.js` (+`padel_duration_min`,
`duration_label`); `admin.html` play-time control; `padel.html` board section + equipment copy;
`app-assets/lfg-padel-page.{js,css}`; `vercel.json` hardening headers; migrations
`padel_duration_minutes` and `leaderboard_padel_points` (the `lfg_leaderboard` SECURITY DEFINER
function). ASVS target L2 (payments + auth + PII). Still NOT deployed at time of writing.

**Tested, with results:**
- **New public endpoint `GET /api/padel-leaderboard`.** Returns only a shortened name
  (first name + last initial), match points, nights played and rank. No `member_id`, no email,
  no padel level, no event date. Verified against a live response with a real signup present.
  Non-GET returns 405. Unpaid rows are excluded, so a dropped booking never surfaces a name.
- **Anon-key RLS probe, re-run with rows actually present.** The previous session's probe ran
  against empty tables, where `200 []` proves nothing. With one real row in each:
  `padel_signups` read -> `[]`, `padel_profiles` read -> `[]`, `members` read -> `[]`.
  Writes: INSERT on `padel_signups` -> 42501 RLS violation. UPDATE returned 204 on both tables,
  which is PostgREST for "zero rows matched", NOT a successful write - confirmed by reading the
  rows back with the service role: `padel_profiles.level` still 4.5 (the tamper set 7),
  `padel_signups.paid` unchanged. RLS holds.
- **The modified `lfg_leaderboard` function.** `CREATE OR REPLACE` preserved its grants:
  anon POST to `/rest/v1/rpc/lfg_leaderboard` returns 401 `permission denied for function`.
  It stays reachable only through `api/leaderboard.js` on the service role. `search_path` is
  still pinned to `public`. It does not appear in the advisor's anon/authenticated
  SECURITY DEFINER exposure list.
- **Padel points into the portal.** 6 match points -> +600 on the community total, 4 -> +400
  (verified against real rows, then purged). Members with no padel rows are unchanged, so the
  existing leaderboard is not revalued.
- **Supabase security advisors:** still no ERROR-level findings. `padel_signups` and
  `padel_profiles` appear as INFO `rls_enabled_no_policy`, the intended service-role-only
  posture. All WARN items pre-existing.
- **Secrets:** no `.env*` tracked by git; `.env` and `.env.*` both in `.vercelignore`. No
  `service_role` / `sb_secret_` / `sk_` value in any client-reachable file. The browser gets
  `sb_publishable_...`, which is the correct public key. The leak scanner's 483 hits are
  variable NAMES (`clientSecret`, `hasPassword`, `token`) reading from env, plus the
  `coaching-app/` subtree, which is a separate deploy and gitignored here.
- **Response headers, now fixed in `vercel.json`:** `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, mic,
  geolocation off; `payment` allowed for Stripe only), `Content-Security-Policy:
  frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`. That takes the five missing
  headers from session I down to one. Needs re-scanning against prod after the deploy lands.
- `npm audit`: unchanged, 1 high (`sharp`, libvips CVEs). Build-time image tool, never reaches
  a browser or a serverless response.

**Open flags:**
- **No `script-src` CSP.** Deliberate, and the one remaining header gap. These pages carry
  large inline `<script>` blocks and there is no build step to nonce them, so a `script-src`
  policy would either break the site or ship `'unsafe-inline'` and protect nothing. Closing it
  properly is its own task: audit the inline blocks, nonce or externalise them, then retest
  Stripe embedded checkout, GTM and Supabase auth. Until then `frame-ancestors` carries the
  clickjacking defence, which was the directive that mattered for `/account` and `/admin`.
- **`event_config` is anon-readable.** Pre-existing and by design (the runs page reads it from
  the browser), but it now also carries the padel fields, so a future night's date, location and
  price are readable before it is announced, even with `padel_enabled = false`. Low impact for
  a public social event; worth knowing before anything genuinely embargoed goes in that table.
- **Production Stripe keys are UNVERIFIED.** Carried forward from session I and still open. All
  local testing ran through a Komplete sandbox test account. Reading the prod key was blocked by
  the permission classifier this session, so this has to be confirmed by a human in the Stripe
  dashboard before real money moves. **This gates the deploy, not the code.**
- `sharp` high CVE, unchanged, not a shipped surface.

---

## Verdict: FLAG
**Date:** 2026-08-09 (session I - padel booking: members-only checkout, Stripe, admin roster)
**Scope:** new `api/padel-status.js`, `api/padel-pay.js`, `api/admin/padel-roster.js`; padel branch in
`api/_lib.js` fulfilment; `api/_email.js` sender + timeout; `login.html` return whitelist;
`app-assets/lfg-padel-page.js`; new tables `padel_signups`, `padel_profiles`; `event_config.padel_*`.
ASVS target L2 (payments + auth + PII). NOT deployed at time of writing.

**Tested, with results:**
- Auth gate on the money endpoint: signed-out POST /api/padel-pay returns 401 `login_required`
  (verified live). Guest checkout was removed at Loay's direction, which also deleted the only
  path in this endpoint that could mint an auth account - the vector behind the ~220 junk
  signups purged the same day.
- Open redirect, `login.html` `safeReturn` after adding `/padel` + `/padel.html`: 13 inputs
  tested, every hostile one rejected (`https://evil.com`, `//evil.com`, `/\evil.com`,
  `javascript:`, `/padel/../admin`, `http://lfgdubai.com.evil.com`); only whitelisted paths pass.
- Anon-key RLS probe on `padel_signups` + `padel_profiles`: read filtered to empty, write DENIED.
  Both tables are RLS-on with zero policies (service-role only), matching the `run_rsvps` posture.
- Supabase security advisors: no ERROR-level findings. New tables appear as INFO
  `rls_enabled_no_policy`, which is the intended posture. WARN items are all pre-existing.
- Admin endpoint `padel-roster` gated by `requireAdmin` (Bearer + `members.is_admin`).
- Price, event date, and capacity are read server-side from `event_config`; the client cannot
  set any of them. Level scoring is server-side. Double-charge guard reads the `payments` table.
- XSS: 8 static leads in the drawer JS, all refuted by inspection (escapeHtml on both href and
  text, `encodeURIComponent` on a constant WhatsApp base, or empty/literal assignments).
- Secrets: no `.env*` tracked by git (0 files); `.env` and `.env.*` both excluded in
  `.vercelignore`, so the local backups never ship.
- `npm audit`: 1 high, `sharp` (libvips CVEs). Build-time image tool only, never reaches a
  browser or a serverless response. Not a shipped-surface risk.

**Open flags (all pre-existing, none introduced here):**
- Response headers on the live site are thin: no CSP, no `X-Content-Type-Options`, no
  clickjacking protection, no `Referrer-Policy`, no `Permissions-Policy`. HSTS is present.
  The padel page inherits this. Worth a `vercel.json` headers block as its own task.
- `public.bot_users_purged` holds the 219 purged bot rows (emails + hashes) as a rollback
  backup. RLS-on with no policy, so unreachable by anon/authenticated. Drop it once the purge
  is confirmed good.
- Supabase "leaked password protection" is disabled (auth advisor WARN).

**Not tested:** production response headers for the padel route (page not deployed yet);
prod Stripe key mode (local ran on a test key - live keys must be confirmed before real money).

---

# Security review — persistent sessions ("stay logged in")

**Date:** 2026-07-22
**Scope:** the auth surface added this session, not a full-site re-audit.
**Target assurance:** ASVS L2 (auth, PII, Stripe payments, 624 real members).

**Verdict: FLAG** — safe to deploy. Nothing blocking. Two pre-existing items to
schedule, listed below.

## What was reviewed

| Artifact | Change |
|---|---|
| `api/session-restore.js` | New. Cookie-backed silent session minting. |
| `public.auth_remember_tokens` | New table (+ rotation-grace columns). |
| `app-assets/lfg-supabase.js` | `requireAuth` cookie fallback; `signOut` scoped local. |
| `admin.html` | Admin sign-out scoped local. |

## Threat model of the new endpoint

The endpoint trades a long-lived device cookie for a fresh Supabase session
without user interaction. The cookie is therefore a **bearer credential worth a
full account session**, and is defended as one:

| Control | Status |
|---|---|
| `HttpOnly` (no JS read, survives XSS-read) | yes |
| `Secure` (HTTPS only) | yes |
| `SameSite=Lax` + POST-only (blocks cross-site CSRF invocation) | yes |
| No CORS headers (a cross-origin caller cannot read the token response) | yes |
| Secret entropy: 256-bit `crypto.randomBytes` | yes |
| Stored as SHA-256 only, never plaintext | yes |
| Timing-safe comparison (`crypto.timingSafeEqual`) | yes |
| Rotated on every use | yes |
| Row-level expiry (1 year), enforced server-side | yes |
| Table RLS on, zero policies → service-role only | yes |
| FK `on delete cascade` from `members` | yes |
| Rate limited per IP | yes (see F-2) |
| Fails closed (any mismatch → 401 + cookie cleared) | yes |

## Defects found and fixed

**R-3 — Grace-window rotation orphaned the freshly-issued secret (found by the
production smoke test, fixed).** After a grace-window match the code set
`prev_token_hash` to the hash it had *matched*, rather than the hash that was
actually current. The secret issued moments earlier fell out of the chain, so
the device holding it was rejected on its next call. Reproduced live against
production: tab B's replay succeeded, then tab A's valid, seconds-old secret
returned 401.

Two changes: `prev_token_hash` now always records the outgoing **current** hash,
and rotation moved from per-restore to a 24-hour cadence (a grace match still
forces one, since the current secret is stored only as a hash and cannot be
handed back). Rotating on every call meant concurrent restores each minted a
different secret and orphaned each other — manufacturing the logout this
feature exists to prevent, in exchange for very little, since there is no reuse
detection for per-use rotation to feed. Covered by 8 tests including an explicit
regression for the production sequence.

**R-1 — Rotation race caused surprise logouts (fixed).**
Rotating the secret on every restore with no grace window had two paths to the
exact bug this feature was built to eliminate:

1. Two tabs (or a PWA opening two pages) restore concurrently. Both validate
   against the same hash, both rotate; the database keeps one secret and the
   browser keeps the other. Next restore → 401 → login screen.
2. The server commits the rotation but the response carrying `Set-Cookie` is
   lost to a dropped connection. The device holds a secret the database no
   longer accepts. Permanent logout on that device.

Fixed by accepting the immediately-previous secret for a 2-minute grace window
(`prev_token_hash` / `prev_valid_until`), re-rotating on a grace hit so every
racing caller converges on its own valid cookie. Covered by 7 unit tests
(`scratchpad/test-rotation.mjs`), including an explicit assertion that the
grace window *closes* on schedule.

**R-2 — Fragile cookie re-parse in `register` (fixed).** Re-matched the raw
header instead of reusing the parsed value; a regex miss would have thrown a
500. Now reuses the parsed cookie.

## Verified correct

- `verifyOtp({ token_hash, type: 'email' })` against an admin-`generateLink`
  hash is the documented pattern (checked against current Supabase docs, not
  memory). `generateLink` does **not** send email, so no member is ever mailed
  by a restore.
- `signOut({ scope: 'local' })` — the previous default (`global`) revoked every
  session the member owned, so signing out on a laptop silently killed their
  phone's PWA session. This was a direct cause of the reported re-logins.
- `.env` is untracked by git and vercelignored.
- Supabase security advisors: no ERROR/CRITICAL. The new table's
  `rls_enabled_no_policy` is INFO and intentional (service-role only), matching
  13 existing tables.
- Leak scan hits on `clientSecret` are Stripe PaymentIntent client secrets
  (public by design); `api/*` hits are server-only Bearer parsing. False
  positives.

## Runtime tests executed

| Case | Expected | Got |
|---|---|---|
| `GET /api/session-restore` | 405 | 405 |
| restore, no cookie | 401 | 401 |
| restore, wrong secret | 401 + cookie cleared | 401 + cleared |
| restore, malformed cookie id | 401 | 401 |
| register, no Bearer | 401 | 401 |
| register, junk Bearer | 401 | 401 |
| rotation/grace/cadence matcher | 8/8 | 8/8 |

### Production (deploy 1, `lfg-167bj0yw9`)

| Case | Expected | Got |
|---|---|---|
| `GET /api/session-restore` | 405 | 405 |
| restore, no cookie | 401 | 401 |
| restore, valid cookie | session minted | minted, `sub` = correct member, `role=authenticated`, refresh token present |
| `Set-Cookie` flags | HttpOnly + Secure + SameSite=Lax | all three, `Max-Age=31536000` |
| grace replay (tab B) | accepted | accepted |
| previously-issued secret (tab A) | accepted | **401 — defect R-3, fixed, needs redeploy** |
| unrelated secret | 401 | 401 |

### Production (deploy 2, `lfg-q8ronndcc`) — after the R-3 fix

| Case | Expected | Got |
|---|---|---|
| tab A first restore | session minted | minted |
| tab B replays original secret (grace) | accepted | accepted |
| tab A re-uses the secret it was issued | accepted | **accepted (R-3 fixed)** |
| tab B re-uses its own secret | accepted | accepted |
| unrelated secret | 401 | 401 |

All test rows removed; `auth_remember_tokens` is back to 0 rows.

## Cookie inventory (measured in a real browser, logged-out homepage)

| Cookie | Origin | Lifetime | Purpose |
|---|---|---|---|
| `__stripe_mid` | Stripe JS | ~1 year | fraud detection |
| `__stripe_sid` | Stripe JS | 30 min | fraud detection |
| `lfg_rm` | ours (new) | 1 year | keeps a logged-in member signed in |

`lfg_sid` (visit analytics) lives in `sessionStorage`, not a cookie. No Google
Analytics, GTM, Meta Pixel, or any advertising tag is present on the site.

Two observations for a future pass, neither introduced by this change:
- **Stripe JS loads on every page**, including the homepage for logged-out
  visitors who are not paying. Its 1-year `__stripe_mid` cookie is easiest to
  defend as strictly necessary when it only loads on pages that actually take
  payment.
- **Google Fonts is loaded from Google's servers**, which discloses each
  visitor's IP to Google. Self-hosting the two Barlow families removes that
  entirely and is faster.

## Open items (not introduced by this change)

**F-1 — Missing security headers (FLAG).** Live site has HSTS but no CSP,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or
clickjacking protection. The site inlines heavy `<script>` blocks, so a real
CSP needs nonces or hashes and is its own scoped task. Worth doing: the new
cookie is `HttpOnly`, but a stored XSS could still call `/api/session-restore`
from the page's own origin and read the returned tokens.

**F-2 — Rate limiting is per-instance (FLAG, accepted).** The in-memory bucket
resets on cold start, matching the existing `send-login-link.js` pattern.
Brute-forcing a 256-bit secret is infeasible, so impact is bounded to database
lookups. Move to a shared store when one exists.

**F-3 — `sharp` high CVE (FLAG, not exposed).** `sharp <0.35.0` inherits libvips
CVEs. It is a **devDependency** used for icon generation and is imported by no
`api/` function and no shipped asset. Fix on the next maintenance pass
(`npm audit fix --force`, breaking).

**F-4 — Session accumulation (note).** Each restore mints a new `auth.sessions`
row. A weekly-active member adds ~52/year. Not a vulnerability; worth a
periodic prune if the table grows.

**F-5 — No member-facing device revocation (note).** A member cannot list or
revoke remembered devices. Sign-out clears the current device only. Consider a
"sign out everywhere" control if a lost-phone request ever arrives; the data
model already supports it (delete by `member_id`).

## Required post-deploy verification

The happy path is unproven until it runs against production:

1. Sign in on a device, confirm an `auth_remember_tokens` row appears.
2. Clear `localStorage` only (simulating Safari's 7-day eviction), reload,
   confirm the session returns with no login screen.
3. Confirm `Set-Cookie` on the restore response carries `HttpOnly; Secure;
   SameSite=Lax`.

---

## Verdict: FLAG
**Date:** 2026-07-25 (session B — meeting-feedback batch)
**Scope:** scoped re-run over this session's new attack surface only. Prior full-lane verdicts above still stand for everything untouched.

**New surface reviewed:** migration 021 (`coaching_clients.steps_target / water_target_ml / sleep_target_h`), migration 022 (`client_metrics.is_rest_day`), client-side writes from the restored `HabitList` (habit_logs) and `RestToggle` (client_metrics), new coach-gated `chat_summary` mode in `api/coach/generate`, `weeklyAvg` computation in `api/coach/client-context`, checkout terms checkbox (client-only), and Kahunas coach-token handling during the exercise import.

| Phase | Result | Notes |
|---|---|---|
| 1 — Secrets / config | PASS (for new surface) | `leak_scan.mjs` BLOCK lines are all `process.env` reads with secret-shaped NAMES plus `.env.local` / `.next` build output, none tracked by git (`git ls-files` shows no `.env*`). No `sk_live_` / `service_role` / `sb_secret_` / `whsec_` string in `.next/static`. gitleaks: 22 hits, all in `.env.local` (untracked, correct home) + `.next/cache` + one `curl -u` shape in `setup-stripe.sh` (reads from env, no literal). Kahunas token written to `research/kahunas-teardown/export/deep/.kahunas-token`, inside a gitignored path. |
| 2 — Headers / CSP | FLAG (unchanged) | HSTS, nosniff, frame protection, Referrer-Policy, Permissions-Policy all present. CSP still **Report-Only** with `'unsafe-inline'` — the deferred item from the earlier pass, unchanged by this session. |
| 3 — RLS + runtime authz | PASS | Runtime probes run against prod (results below). No new table; new columns inherit existing table policies. Supabase security advisors: 0 ERROR / 0 CRITICAL; WARN + INFO items all pre-existing and unrelated to the new columns. |
| 4 — Web-vuln sweep | FLAG (no new items) | Static scan's XSS hits are the two pre-existing JSON-LD `dangerouslySetInnerHTML` blocks with `JSON.stringify` over static objects (book/packages), not user input. `eval` hits are dev/QA scripts (Playwright evaluate), never shipped. 379 source maps exist locally; prod serves them 403. |
| 5 — Dependencies | FLAG (unchanged) | `npm audit`: 0 critical, 12 high, 1 moderate. Every high is transitive dev tooling (`minimatch`/`brace-expansion` DoS via eslint chain, postcss XSS-in-stringify via next, sharp/libvips inherited). No runtime-exploitable critical. Unchanged from the prior pass; no dependency added this session. |

### Runtime authz probes (executed against production)
- anon key UPDATE `coaching_clients.steps_target` → 0 rows, value verified still `null` after
- anon key INSERT `habit_logs` → DENIED 42501
- anon key INSERT `client_metrics` (is_rest_day) → DENIED 42501
- signed-in client UPDATE own ring targets → 0 rows (coach-only, correct: clients hold SELECT-only on `coaching_clients`)
- signed-in client SELECT other clients → 0 rows
- signed-in client INSERT `habit_logs` for ANOTHER client → DENIED 42501
- signed-in client INSERT `client_metrics` for ANOTHER client → DENIED 42501
- signed-in client UPDATE another client's rest-day → 0 rows
- client bearer → `POST /api/coach/generate` (chat_summary) → 401; `GET /api/coach/client-context` → 401; anon → 401
- Zero stray rows left on the probed client afterwards

### Why FLAG, not PASS
1. Enforcing CSP still deferred (Report-Only live, `'unsafe-inline'` in script-src) — carried over, needs the nonce pass through middleware; the iOS Capacitor shell makes it a real piece of work, not a config toggle.
2. 12 high (0 critical) dev-tooling CVEs open.
3. Cookie flags graded only on an unauthenticated response.

### Session-specific follow-ups
- **Rotate the Kahunas password** for ahmedsamsfit@gmail.com: it was shared in chat and used in a browser session this session. The import is complete, so nothing breaks when it changes.
- Delete `research/kahunas-teardown/export/deep/.kahunas-token` once no further Kahunas pulls are planned (gitignored, but it is a live session token).

---

## Verdict: FLAG
**Date:** 2026-07-30 (session C — web push announcements, run-club site)
**Scope:** scoped re-run over this session's new attack surface only, on `www.lfgdubai.com` (vanilla HTML + Vercel serverless). Prior verdicts above stand for everything untouched. ASVS target L2.

**New surface reviewed:** tables `run_push_subscriptions` and `run_push_campaigns` (both RLS-on, no policies, service-role only); endpoints `api/push-key` (public GET, returns the VAPID **public** key only), `api/push-subscribe` (member Bearer, plus a deliberately unauthenticated service-worker rotation path), `api/push-unsubscribe` (member-scoped), `api/admin/push-send` (admin only), `api/admin/push-dispatch` (admin or `CRON_SECRET`); a per-minute Vercel cron; `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` added to the `lfg` project env; new runtime dependency `web-push@3.6.7`; a notification `url` the service worker opens; admin history table rendering admin-authored title/body.

| Phase | Result | Notes |
|---|---|---|
| 1 — Secrets / config | PASS (for new surface) | `VAPID_PRIVATE_KEY` is read in `api/_push.js` and `api/admin/push-send.js` only, never in client-reachable HTML/JS. `/api/push-key` returns the public half by design (it is meant to ship to every browser) and is served with `Cache-Control: public, max-age=3600`. `leak_scan.mjs`'s one scoped hit, `api/admin/push-dispatch.js:17`, is a false positive: it parses an inbound `Authorization` header, holding no literal. The keypair is reused from the coaching app rather than minted fresh, so no new secret was created. |
| 2 — Headers / CSP | FLAG (unchanged, pre-existing) | `scan_headers.mjs` on `/account`: HSTS present; CSP, nosniff, frame protection, Referrer-Policy, Permissions-Policy all still missing. This is open item **F-1** from the 2026-07-22 pass, site-wide and untouched by this session. Nothing here made it worse. |
| 3 — RLS + runtime authz | PASS | Both new tables RLS-on with zero policies (deny-all to `anon`/`authenticated`, service-role only), matching the 14 tables already on that pattern. Supabase security advisors: 0 ERROR, 0 CRITICAL; the two new `rls_enabled_no_policy` INFO lines are the intended design. Runtime probes below. |
| 4 — Web-vuln sweep | PASS (for new surface) | `web_vuln_scan.mjs` returned no findings in any file added this session. Open-redirect defence is explicit: `cleanUrl()` in `push-send.js` accepts only a relative path or an `https://*.lfgdubai.com` URL, so the SW's `openWindow` cannot be pointed off-site. Admin history escapes title and body through `esc()`; notification title/body render as text via `showNotification`, not HTML, and are capped at 60/180 chars server-side. |
| 5 — Dependencies | FLAG (unchanged) | `web-push@3.6.7` itself audits clean (deps: asn1.js, http_ece, https-proxy-agent, jws, minimist). `npm audit` on this repo reports 1 high, and it is open item **F-3**: `sharp <0.35.0` inheriting libvips CVEs. `sharp` is a **devDependency** used by local icon tooling, is not imported by any `api/` function, and `node_modules` is `.vercelignore`d, so it never enters the serverless bundle. |

### Runtime authz probes (executed against production)
- anon key `SELECT run_push_subscriptions` → **0 rows visible while service-role sees 1** (RLS filtering confirmed, not an empty table)
- anon key `INSERT run_push_subscriptions` → DENIED 42501
- anon key `INSERT run_push_campaigns` → DENIED 42501
- anon key `DELETE run_push_subscriptions` → 0 rows affected; the live member subscription verified still present with its original `created_at`
- unauthenticated `GET /api/admin/push-send` → 401
- unauthenticated `POST /api/admin/push-dispatch` → 401; wrong bearer → 401
- `CRON_SECRET` bearer → `push-send` (the composer) → 401/403, i.e. the cron token cannot author or send an announcement, only dispatch what an admin already scheduled
- `POST /api/push-subscribe` with no token and no `old_endpoint` → 401; malformed subscription → 400; non-https endpoint → 400; rotation against an unknown endpoint → 404

### Accepted design decision: the unauthenticated rotation path
`api/push-subscribe` accepts a POST with no session when it carries `old_endpoint`, because the `pushsubscriptionchange` event fires in the service worker where no Supabase session exists. Ownership is proven by knowing the previous endpoint, which is a long unguessable bearer-grade string issued by the push service. Residual risk: someone holding a member's old endpoint could rebind that row to their own device. Accepted because the payloads are broadcast announcements with no personal data, the rotation cannot change `member_id`, and this is the standard pattern for the event. Revisit if push is ever used to deliver per-member content.

### Why FLAG, not PASS
1. **F-1** missing security headers on the run-club site (CSP, nosniff, frame protection, Referrer-Policy, Permissions-Policy) — pre-existing, site-wide, carried over. Under the lane's own rubric "no CSP on an authenticated app" is BLOCK-class; it is recorded as a standing open item rather than a gate on this feature, because it predates this work, is unchanged by it, and blocks every deploy equally until the inline-script nonce pass is done.
2. **F-3** `sharp` high CVE open (devDependency, not in the shipped bundle).
3. Cookie flags again graded only on an unauthenticated response.

### Session-specific follow-ups
- The header pass (**F-1**) is now the oldest carried item on this site and is worth scheduling as its own task; the run-club HTML inlines large `<script>` blocks, so it needs hashes or nonces, not a config toggle.
- `VAPID_PRIVATE_KEY` is now set on two Vercel projects (`lfg` and `lfg-coaching`). If it is ever rotated, both must be updated together or one site's existing subscriptions go silent.

---

## Verdict: FLAG
**Date:** 2026-08-05 (session D — /padel preview design-polish)
**Scope:** scoped to this session's edits only: `padel.html`,
`app-assets/lfg-padel-page.css`, `app-assets/lfg-padel-page.js`, and two new
WebP image assets. Scans re-run against the FINAL state of those files, after
the last edit (the ball-flicker fix). Prior verdicts above stand for everything
untouched. ASVS target L1 for this surface.

**Surface reviewed:** a static, undeployed, `noindex` preview page. The change
swapped a CSS-drawn object for a raster image, rewrote a scroll-driven
animation, and recoloured the palette. It added **no** API route, form submit,
auth, database client, secret read, or third-party script. The booking drawer
remains a stub that links to WhatsApp; no checkout exists on this page yet.

| Phase | Result | Notes |
|---|---|---|
| 0 — Surface detection | done | Static HTML + vanilla JS, no bundler, no framework, no manifest for this surface. No new attack surface introduced. |
| 1 — Secrets / config | **PASS** | `leak_scan.mjs` over the final files: no secrets, no key-shaped values, no tracked `.env`. Confirmed by grep: the shipped JS contains no `process.env` read and no network call of any kind. |
| 2 — Headers / CSP | **not run (scoped out, stated)** | The page is not deployed; headers are a property of the host and this change alters none. Site-wide **F-1** still stands and still applies here at launch. Per the lane's own rule this skipped measurement is why the verdict cannot be PASS. |
| 3 — RLS / runtime authz | **n/a** | No Supabase client, no auth, no data access on this surface. |
| 4 — Web-vuln sweep | **FLAG** | `web_vuln_scan.mjs`: one finding, missing `/.well-known/security.txt` (RFC 9116), site-wide and pre-existing. Manual sink review of the final JS and HTML found no `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `srcdoc`, no location assignment from input, and no `fetch`/XHR. |
| 5 — Dependencies | **n/a** | This surface ships zero third-party JS; nothing was installed this session. |

### Why FLAG, not PASS
1. Header/CSP grading was scoped out because the page is not deployed — a skipped measurement caps the verdict at FLAG by the lane's rule, independent of the change's own cleanliness.
2. Missing `security.txt`, site-wide and pre-existing.

### Required before this page goes live
The booking drawer is a stub today. Wiring it to the real `run-register` +
`run-pay` Stripe flow creates live surface, and this verdict must be re-issued
rather than carried forward:
- price resolved server-side from `event_config`, never from the client
- CSRF and rate-limit checks on the registration endpoint
- headers/CSP graded against the deployed URL (**F-1**)
- `security.txt` added, which also clears the FLAG above

## 2026-08-12 — King of the Court board + padel waiting list
**Verdict: FLAG** (standing item only; no new findings from this session's surface.)

New surface reviewed: `/api/padel-board` (public read), `/api/admin/padel-night` (admin write),
`/api/padel-waitlist` (member), tables `padel_teams` / `padel_matches` / `padel_night` /
`padel_waitlist`, pages `/padel-board` + `/padel-score` (both noindex).

Runtime checks actually executed (not asserted):
- **Anon-key RLS probe** — direct PostgREST reads of all four new tables with the anon key
  return `[]`, and an anon INSERT into `padel_waitlist` returns 401. RLS-on-with-no-policies is
  the intended posture (service-role only), and the probe confirms it holds at runtime rather
  than just in the advisor.
- **Unauthenticated privileged-endpoint probes** — `build_teams`, `score`, and `ping` on
  `/api/admin/padel-night` all return 401. `/api/padel-waitlist` returns 401 signed out.
- **Input handling** — `/api/padel-board?date=` with an injection-shaped value is rejected by
  the `YYYY-MM-DD` regex and falls back to the configured night. Scores are clamped 0-50
  server-side (a typo of 60 for 6 would otherwise distort the tiebreak all night).
- **Client-bundle leak scan** — 0 hits across every file written this session. The score page
  carries the anon key only, the same posture as `admin.html`; no service-role key is
  client-reachable.
- **Supabase security advisors** — the four new tables appear at INFO (`rls_enabled_no_policy`,
  intended). No ERROR-level advisor. All WARN items pre-date this session.
- **Headers on `/padel-board`** — HSTS, nosniff, frame-ancestors, Referrer-Policy and
  Permissions-Policy all present.

Standing item (unchanged, previously recorded): the site CSP still has no `script-src`, so
scripts are unrestricted. Not introduced by this work and not made worse by it; both new pages
load only same-origin assets plus the Supabase CDN the rest of the site already uses.

Data-exposure note: the board is displayed publicly on a venue TV, so it deliberately returns
first name + last initial only, matching `/api/padel-leaderboard`. No email, phone, level or
payment data reaches either new page.

---

## 2026-09-07 — run-day copy sweep + admin query fixes (site-security lane)

**Verdict: FLAG** — deliverable with the standing items below disclosed. No BLOCK survived verification.

Changed this session: `.vercelignore`, `api/_lib.js`, `api/admin/run-rsvps.js`, `index.html`,
`track.html`, `shop.html`, `run-checkin.html`, `admin.html`, `llms.txt`, `app-assets/lfg-track.js`.

### Fixed this session
Internal files were being served publicly and are now 404: the August revenue and partner
traction reports, `WHATSAPP-AI-TEAM-GUIDE.md`, a meeting transcript, `SECURITY.md`,
`BUILD-STATE.md`, `PADEL-DESIGN.md`, and `sql/2026-09-01_crm_leads.sql`. `.vercelignore`
listed private files one at a time, so each new internal doc shipped by default; it now
excludes by type and directory. All but the SQL file predate this session; that one was
published by a deploy earlier the same day. Assume the reports were reachable 1-5 Sep.

### Verified at runtime, not asserted
- **Anon-key read probe** — `members`, `payments`, `run_rsvps`, `run_registrations`,
  `coaching_clients`, `check_ins`, `client_metrics`, `padel_signups`, `promo_codes`,
  `merch_orders`: every one returns `[]` with the publishable key.
- **Anon-key write probe** — inserts on `members` and `run_rsvps` return 401. A PATCH zeroing
  `payments.amount_aed` returned 204 (PostgREST reports success on a zero-row update), so it
  was checked against the database: 596 run payments, all still 30.00, total 17,880 AED,
  none zeroed. RLS held.
- **Unauthenticated admin endpoints** — `/api/admin/{stats,roster,paid-runs,run-rsvps,leads,export}`
  all 401.
- **RLS coverage** — every table in `public` has RLS enabled (zero exceptions). The 24 tables
  the advisor lists at INFO as "enabled, no policy" are deny-all by design: browser code never
  reads them, the serverless functions use the service key.
- **`.git` not served** (404). No `service_role` / `sb_secret_` value in any client-reachable
  file or tracked in git.

### Scanner findings dismissed with reasons
- `gitleaks`: 7 hits, all the Supabase **publishable/anon** key (`role: anon` decoded from the
  JWT payload). Public by design, and proven inert by the probes above.
- `leak_scan` 389 and `web_vuln_scan` 18 BLOCK: every one sits in `coaching-app/.next`,
  `research/`, or `scripts/`. None deploy (`.vercelignore`), `coaching-app` has 0 files tracked
  in this repo, and the flagged research export is gitignored and was never committed. Re-run
  against the deployed file set only: leak scan PASS, web-vuln FLAG with no BLOCK.

### Standing FLAGs (none introduced this session)
1. Site CSP still has no `script-src`; scripts are unrestricted. Unchanged.
2. No `security.txt`. One file under `.well-known/` fixes it.
3. `npm audit` high: `sharp` <0.35.0 (libvips CVEs). devDependency only, not imported by
   anything under `api/`, so it does not reach the deployed functions.
4. 48 `innerHTML` sinks across `app-assets/*.js`. Pre-existing; the diff this session added
   none, every new write uses `textContent`.
5. Security baseline 1/9 (legacy repo predating the 2026-08-29 scaffold).
6. Supabase advisors: WARN only. Mutable `search_path` on `short_name`, `vector` extension in
   `public`, several `SECURITY DEFINER` functions callable by `anon`/`authenticated`, and
   leaked-password protection disabled. No ERROR-level advisor.
