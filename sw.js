/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — SERVICE WORKER
   ───────────────────────────────────────────────────────────────────────────
   Scope: the directory this file is served from (repo root => whole site).

   DESIGN CONSTRAINTS observed in the existing app before writing this:

   1. THE APP ALREADY OWNS A CACHE CALLED `rankspark-shell`.
      index.html decodes its base64 payload once and stores the decoded HTML
      in caches.open('rankspark-shell') under the key '/__rankspark_app__',
      validated by an 'x-rs-sig' header. This worker therefore:
        • uses its own distinctly-named caches (`rankspark-pwa-*`), and
        • NEVER deletes a cache it does not own during activate cleanup.
      Wiping `rankspark-shell` would not break the app (it re-decodes) but it
      would silently undo its startup optimisation on every SW update.

   2. NETWORK-FIRST FOR THE DOCUMENT.
      index.html is a ~2.6 MB single file that is redeployed often. A
      cache-first document would strand users on a stale build after a push.
      Network-first with a cache fallback keeps updates instant online and
      still opens offline.

   3. NEVER TOUCH AUTH / PAYMENTS / DATA.
      Firebase, Firestore, Google auth, Razorpay and question-pack CDNs are
      explicitly bypassed. Caching a Firestore or auth response would break
      sign-in and could serve one user's data to another. Only same-origin
      static assets and Google Fonts are cached.

   4. NON-GET AND RANGE REQUESTS ARE PASSED THROUGH UNTOUCHED.
      Question packs are fetched with Range headers; a cached 200 response
      would corrupt a 206 partial read.
   ═══════════════════════════════════════════════════════════════════════════ */

const VERSION     = 'v1';
const STATIC_CACHE = `rankspark-pwa-static-${VERSION}`;
const FONT_CACHE   = `rankspark-pwa-fonts-${VERSION}`;

/* Caches this worker is allowed to delete. Anything else on the origin —
   notably the app's own `rankspark-shell` — is left strictly alone. */
const OWNED_PREFIX = 'rankspark-pwa-';

/* Minimal, safe precache. index.html is fetched fresh on install so the very
   first offline load has something to show; icon.png and the manifest are
   tiny and needed by the install prompt itself. */
const PRECACHE = ['./', './index.html', './manifest.json', './icon.png'];

/* Hosts that must ALWAYS go straight to the network. */
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'www.googleapis.com',
  'apis.google.com',
  'accounts.google.com',
  'checkout.razorpay.com',
  'api.razorpay.com',
  'lumberjack.razorpay.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'raw.githubusercontent.com',
  'raw.github.com',
  'github.com',
  'lens.google.com'
];

/* Google Fonts: stylesheet + font files are safe and worth caching. */
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    /* addAll() is atomic: one 404 (e.g. icon.png not committed yet) would
       abort the whole install and the SW would never activate. Add each
       entry independently so a missing optional asset cannot block install. */
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && res.ok) await cache.put(url, res.clone());
      } catch (e) { /* offline at install time — fetch handler will fill in */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      /* Only ever remove OUR OWN stale versions. */
      if (k.startsWith(OWNED_PREFIX) && k !== STATIC_CACHE && k !== FONT_CACHE) {
        return caches.delete(k);
      }
      return Promise.resolve();
    }));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* Let the page tell a waiting worker to take over immediately. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isBypassed(url) {
  return BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* Never interfere with writes, auth flows or partial reads. */
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isBypassed(url)) return;

  /* ── 1. Navigations: network-first, fall back to cache, then to the
         cached shell. Guarantees a fresh build online, opens offline. ── */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) {
          const c = await caches.open(STATIC_CACHE);
          c.put('./index.html', preload.clone()).catch(() => {});
          return preload;
        }
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(STATIC_CACHE);
          c.put('./index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (e) {
        const c = await caches.open(STATIC_CACHE);
        return (await c.match('./index.html')) ||
               (await c.match('./')) ||
               new Response(
                 '<!doctype html><meta charset="utf-8">' +
                 '<title>RankSpark — offline</title>' +
                 '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
                 'background:#06060B;color:#fff;font-family:system-ui,sans-serif;text-align:center">' +
                 '<div><h1 style="font-size:20px;margin:0 0 8px">You are offline</h1>' +
                 '<p style="color:#9aa4c0;font-size:14px;margin:0">' +
                 'Open RankSpark once while connected, then it will work offline.</p></div>',
                 { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 200 }
               );
      }
    })());
    return;
  }

  /* ── 2. Google Fonts: stale-while-revalidate. ── */
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  /* ── 3. Same-origin static assets: cache-first, refresh in background. ── */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      if (hit) {
        fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        }).catch(() => {});
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (e) {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  /* Everything else (other CDNs) goes to the network untouched. */
});
