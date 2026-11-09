// Surfers Surf als Web-App: immer zuerst aus dem Netz laden (neueste Version), ohne Netz aus dem Zwischenspeicher
const CACHE = 'surfers-surf-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './3d/', './3d/index.html', './3d/main.js', './3d/sound.js', './3d/surfer.js', './3d/rig.js', './3d/models/surfer.glb',
  './3d/models/surfer-lei.glb', './3d/models/surfer-nalu.glb', './3d/models/surfer-koko.glb', './3d/models/surfer-diver.glb', './3d/models/surfer-finn.glb', './3d/vendor/three.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok && (new URL(req.url).origin === location.origin || req.url.startsWith('https://fonts.'))) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});
