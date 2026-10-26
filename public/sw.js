const CACHE_NAME = '2one-engine-v1';
const pendingWrites = new Map();

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith('2one-engine-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  const enginePath = `${scopePath}ffmpeg/`;
  const isEngineFile = url.origin === self.location.origin
    && url.pathname.startsWith(enginePath)
    && /ffmpeg-core\.(?:js|wasm)$/.test(url.pathname);
  if (!isEngineFile) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(request);
    if (saved) return saved;

    const response = await fetch(request);
    if (!response.ok) return response;

    const write = cache.put(request, response.clone()).catch(() => false);
    pendingWrites.set(url.href, write);
    event.waitUntil(write.finally(() => pendingWrites.delete(url.href)));
    return response;
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CHECK_ENGINE_CACHE' || !event.data.url) return;
  const url = new URL(event.data.url, self.registration.scope);
  const port = event.ports[0];

  event.waitUntil((async () => {
    try {
      await pendingWrites.get(url.href);
      const cache = await caches.open(CACHE_NAME);
      port?.postMessage({ cached: Boolean(await cache.match(url.href)) });
    } catch {
      port?.postMessage({ cached: false });
    }
  })());
});
