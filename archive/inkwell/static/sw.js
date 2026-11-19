// Offline fallback only. Never store mail, credentials, API responses or authenticated HTML.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>inkwell — Offline</title><body><h1>A moment of quiet.</h1><p>inkwell cannot reach your private server. Start Inkwell on your desktop or reconnect to your network, then reload.</p><p>For privacy, mail is not cached in this mobile browser.</p><a href="/">Try again</a></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
        ),
    ),
  );
});
