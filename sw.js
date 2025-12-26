// sw.js
const CACHE_NAME = "calendari-astromallorca-cache-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

// Install: cache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Allow app to force activation
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Fetch strategy:
// - App shell: cache-first
// - Everything else: network-first with cache fallback (good for sheets/ics/json)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only GET
  if (req.method !== "GET") return;

  const isAppShell = APP_SHELL.some((p) => url.pathname.endsWith(p.replace("./","")));

  if (isAppShell || url.origin === self.location.origin) {
    // cache-first for local files
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // network-first for external (sheets, ics via r.jina.ai)
  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});
