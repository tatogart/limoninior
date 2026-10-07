// Limoninior service worker: app-shell caching + notification clicks.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = [
  '/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/api.js', '/js/theme.js',
  '/vendor/socket.io.esm.min.js', '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Never cache API, realtime, media (private) or the admin page.
  if (/^\/(api|socket\.io|media|admin)/.test(url.pathname)) return;

  // Network-first (server sends ETags, so this is cheap): always fresh online, cached shell offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && req.mode !== 'navigate') {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
        }
        return res.ok || req.mode !== 'navigate' ? res : caches.match('/').then((r) => r || res);
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/') : Response.error())),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => new URL(c.url).origin === location.origin);
    if (client) {
      await client.focus();
      client.postMessage({ type: 'open-chat', chatId });
    } else {
      await self.clients.openWindow('/');
    }
  })());
});
