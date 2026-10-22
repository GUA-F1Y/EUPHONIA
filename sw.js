/* EUPHONIA app-shell cache. User audio and project files are stored in IndexedDB, not Cache Storage. */
const CACHE_NAME = 'euphonia-studio-v0350';
const CORE_ASSETS = [
  './', './index.html', './styles.css', './euphonia-storage.js', './app.js', './euphonia-config.js', './music-accounts.js', './musicfy-features.js', './music-discovery.js',
  './euphonia-daw.js', './manifest.json', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Keep the previous worker/cache active if any required shell asset cannot be cached.
      // A partially cached new app shell is worse than retaining the previous working version.
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE_NAME);
      console.error('EUPHONIA update failed to precache its core assets; keeping the previous version.', error);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('euphonia-studio-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request);
        if (response.ok) cache.put('./index.html', response.clone()).catch(() => {});
        return response;
      } catch (_) {
        return (await cache.match(request)) || (await cache.match('./index.html')) || new Response('EUPHONIA offline shell unavailable.', { status: 503 });
      }
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && ['script', 'style', 'image', 'font'].includes(request.destination)) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (_) {
      return new Response('This resource is not available offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});