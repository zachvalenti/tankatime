/* Service worker: the offline half of the app.
 *
 * A service worker is a script the browser runs beside the page,
 * intercepting its network requests. This one saves every asset into
 * the Cache Storage API on install and answers later requests from
 * that cache first — so after one visit, Tanka Time opens with no
 * network at all.
 *
 * Bump the CACHE name with every release: a changed sw.js makes the
 * browser install the new worker, which re-downloads the assets under
 * the new name and deletes the old cache on activate.
 */

const CACHE = 'tanka-time-v29';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'count.js',
  'md.js',
  'syllables.json',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

// install: fetch and cache every asset, atomically — if one download
// fails, the whole install fails and the old worker stays in charge.
// skipWaiting lets the new worker take over without a tab close.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// activate: the new worker is in charge; delete every older cache,
// then claim open tabs so they're served by this worker immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// fetch: cache first, network as fallback (anything new gets cached
// for next time). Cache-first makes the app instant and offline-proof;
// the trade is that updates arrive via the CACHE bump above, not by
// re-checking the network on every load.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
    ).catch(() => {
      // offline and not in cache: hand navigations the app shell
      if (e.request.mode === 'navigate') return caches.match('./');
      return Response.error();
    })
  );
});
