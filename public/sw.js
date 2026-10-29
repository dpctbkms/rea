// 앱 껍데기(화면 파일)만 저장해서 오프라인에서도 켜지게 한다. 시세는 거래소에서 바로 받으므로 건드리지 않는다.
// 화면 파일(index.html)은 늘 새로 받아 보고, 안 되면 저장해 둔 것을 쓴다.
// 나머지(이름에 해시가 붙은 js·css, 아이콘)는 저장해 둔 것을 먼저 쓴다.
const CACHE = 'rea-chart-v1';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/favicon.svg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put('./', res.clone());
        return res;
      } catch {
        return (await cache.match('./')) ?? Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
