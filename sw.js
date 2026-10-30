/*
 * Offline support for the installed (home-screen) app: the app's own files
 * are served from a cache and refreshed in the background. Dictionary and
 * Wiktionary lookups still go to the network.
 */
const CACHE = 'inkwell-v3';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/cloud.js',
  'js/spellcheck.js',
  'js/definitions.js',
  'js/lexicon.js',
  'js/lexicons/norse.js',
  'js/lexicons/latin.js',
  'js/lexicons/greek.js',
  'js/lexicons/argot.js',
  'js/lexicons/lingala.js',
  'js/lexicons/tshiluba.js',
  'js/calc.js',
  'js/media.js',
  'js/blocks.js',
  'js/docx.js',
  'js/export.js',
  'vendor/jspdf/jspdf.umd.min.js',
  'vendor/html2canvas/html2canvas.min.js',
  'js/sketch.js',
  'js/app.js',
  'vendor/typo/typo.js',
  'vendor/typo/en_US.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Same-origin files: answer from the cache at once, then update it.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const fresh = fetch(event.request).then(res => {
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
