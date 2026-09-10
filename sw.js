const C = 'edi-v1';
const FILES = ['./', './index.html', './app.css', './app.js', './manifest.json', './icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(FILES))));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { caches.open(C).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
});
