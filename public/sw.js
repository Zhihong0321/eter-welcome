const CACHE_NAME = 'eter-customer-app-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/invoice.html',
  '/seda-form.html',
  '/submit-payment.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/api.js',
  '/config.js',
  '/manifest.json',
  '/logo/eternalgy.png',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// Cache only the same-origin app shell. Customer-portal / SEDA calls go to
// Solar Calculator v2. Official-receipt lists are proxied on this origin at
// /api/ and must stay live — one new verified payment means one new receipt.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
