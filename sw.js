// Offline support: cache-first for the app shell, refreshed in the background.
const CACHE = 'inkwell-v18';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/platform.js', 'js/layers.js', 'js/three3d.js', 'js/ibis.js', 'js/pool.js', 'js/worker.js', 'js/media.js', 'js/timelapse.js', 'js/reference.js', 'js/palettes.js', 'js/video.js', 'js/exporters.js', 'js/util.js', 'js/icons.js', 'js/doc.js', 'js/history.js', 'js/engine.js', 'js/brushes.js', 'js/tools.js',
  'js/importers.js', 'js/gif.js', 'js/storage.js', 'js/ui.js', 'js/anim.js', 'js/webtoon.js',
  'vendor/jszip.min.js', 'vendor/three.bundle.js', 'vendor/jsQR.js', 'vendor/mp4-muxer.min.mjs', 'vendor/sql-wasm.js', 'vendor/sql-wasm.wasm',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
