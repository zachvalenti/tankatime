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

const CACHE = 'tanka-time-v55';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'count.js',
  'simple.js',
  'modes.js',
  'markdown.js',
  'fountain.js',
  'marks.js',
  'syllables.json',
  'tenhundred.txt',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

// install: fetch and cache every asset, atomically — if one download
// fails, the whole install fails and the old worker stays in charge.
// skipWaiting lets the new worker take over without a tab close.
//
// cache: 'reload' on every request is what makes a release land whole.
// A plain fetch may be answered from the browser's own HTTP cache, so a
// new worker can fill its fresh cache with stale files — and a half-new
// set is worse than an old one: last release's index.html doesn't load
// markdown.js, and this release's app.js reaches for it on line one.
// Going past the HTTP cache means the new name always holds new bytes.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
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
  /* Never answer for this script out of the cache.
   *
   * The browser fetches worker scripts outside the worker, so
   * registration is unaffected either way. But a *page* asking for sw.js
   * comes through here, and that is exactly how the app's /version mode
   * and probe.html read "what release does the server have?" — answering
   * from cache handed them this copy's own version, so the comparison was
   * a file against itself and the verdict was "latest" no matter how far
   * behind the app actually was. A cache-buster couldn't save it either:
   * the caches.match below ignores the query string.
   *
   * Returning without respondWith lets the request go to the network
   * normally, which for one small file on demand is the right trade.
   */
  if (new URL(e.request.url).pathname.endsWith('/sw.js')) return;
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
