// Minimal service worker for installability (PLAT-4).
// It caches nothing: private pages and health data must never be stored by the worker.
// It only shows a plain offline page when a page navigation fails.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nurra</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><h1>You are offline</h1><p>Nurra will reconnect when your internet is back.</p></body></html>',
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
        ),
    ),
  );
});
