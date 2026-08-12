// LFG Dubai service worker - installable PWA + light offline support.
// Strategy:
//   - HTML pages: network-first, fall back to cache only if offline
//   - CSS / JS shell: network-first too (no flash of old design when we ship updates)
//   - Images / fonts / icons: cache-first (revalidate-in-background)
//   - /api/*: network-first, never cached
//   - Auth / admin / Stripe / Supabase: bypass SW entirely
//
// IMPORTANT: bump VERSION on any shell change. Old caches are deleted on activate.
// The waiting SW is asked to skipWaiting + claim clients so updates take effect
// on the FIRST reload, not the second.

const VERSION = 'lfg-v8-2026-07-29-push';
const STATIC_CACHE = 'lfg-static-' + VERSION;
const RUNTIME_CACHE = 'lfg-runtime-' + VERSION;

// Tiny precache - just enough to open the app cold. Skip versioned CSS to avoid
// caching a specific revision; the runtime fetch handler will cache whatever ships.
const PRECACHE = [
  '/',
  '/bootcamp.html',
  '/account',
  '/login',
  '/site.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every cache that isn't this version.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Tell every open tab the SW updated so they can choose to reload.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.postMessage({ type: 'SW_UPDATED', version: VERSION });
  })());
});

function isApi(url) { return url.pathname.startsWith('/api/'); }
function isAdmin(url) { return url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/admin'); }
function isAuthCallback(url) { return url.pathname.includes('/auth/') || url.searchParams.has('access_token'); }
function isStripe(url) { return url.host.includes('stripe.com'); }
function isSupabaseAuth(url) { return url.host.endsWith('.supabase.co') && (url.pathname.includes('/auth/') || url.pathname.includes('/rest/')); }
function isHtml(req, url) {
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('Accept') || '';
  return accept.includes('text/html');
}
function isShellAsset(url) {
  return /\.(css|js)(\?|$)/.test(url.pathname + url.search);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Admin / auth / Stripe / Supabase: pass-through, never cache, never serve stale.
  if (isAdmin(url) || isAuthCallback(url) || isStripe(url) || isSupabaseAuth(url)) return;

  // API GETs: network-first, no caching.
  if (isApi(url)) {
    event.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  // HTML + CSS/JS shell: network-first. We cache the latest copy so offline still works,
  // but the user ALWAYS sees the freshest shell when online - no flash of old design.
  if (isHtml(req, url) || isShellAsset(url)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (e) {
        const hit = await caches.match(req);
        return hit || caches.match('/');
      }
    })());
    return;
  }

  // Images / fonts / icons: cache-first with background revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || fetchPromise;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ===== Web push =====
// The server sends JSON: { title, body, url, tag }. Anything malformed still shows
// a notification rather than nothing - a silent push looks like a broken feature,
// and some browsers penalise a push event that resolves without showing one.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { /* not JSON */ }

  const title = payload.title || 'LFG Dubai';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/favicon-96x96.png',
    // Same tag collapses repeats instead of stacking five copies on the lockscreen.
    tag: payload.tag || 'lfg-announce',
    renotify: true,
    data: { url: payload.url || '/account' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap the notification: focus an already-open LFG tab and steer it to the link,
// otherwise open a new window. Without the focus path, a member with the PWA
// already open gets a second window every time.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/account';

  event.waitUntil((async () => {
    const url = new URL(target, self.location.origin);
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin !== url.origin) continue;
      await c.focus();
      if ('navigate' in c) { try { await c.navigate(url.href); } catch (e) {} }
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});

// Chrome rotates a subscription occasionally. Re-subscribe with the same key and
// hand the new endpoint to the server, so a member does not silently go dark.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch('/api/push-key');
      const { key } = await res.json();
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key
      });
      await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          old_endpoint: event.oldSubscription && event.oldSubscription.endpoint
        })
      });
    } catch (e) { /* member re-opts-in from /account if this misses */ }
  })());
});
