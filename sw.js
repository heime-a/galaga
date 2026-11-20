const CACHE_PREFIX = 'galaga-arcade-';
const CACHE_NAME = `${CACHE_PREFIX}v8`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        fetch(url, { cache: 'no-store' }).then(res => {
          if (res && res.ok) return cache.put(url, res);
        })
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const reqUrl = event.request.url;
  const isNav = event.request.mode === 'navigate';
  // Fetch by URL string (not Request with mode:'navigate') so Chrome never throws TypeError with cache:'no-store'
  event.respondWith(
    fetch(reqUrl, { cache: 'no-store' })
      .then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(isNav ? './index.html' : reqUrl, clone);
          });
        }
        return response;
      })
      .catch(() => caches.match(isNav ? './index.html' : event.request).then(hit => hit || caches.match(event.request)))
  );
});
