const CACHE = 'calorie-tracker-v10';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js',
];

// Install: pre-cache the app shell and Chart.js
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate: remove any old caches from previous versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API/sync calls — always hit the network
  if (url.hostname.endsWith('workers.dev')) return;

  // CDN assets (Chart.js) — cache first, update in background
  if (url.hostname.includes('jsdelivr.net')) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fresh = fetch(request).then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        });
        return cached || fresh;
      })
    );
    return;
  }

  // HTML navigation — network first, fall back to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
});
