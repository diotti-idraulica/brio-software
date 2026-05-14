// sw.js — Service Worker Brio
// Strategia: network-first per app.js/HTML (per avere sempre l'ultima versione),
// cache-first per assets statici. Estendibile in futuro per modalità offline cassa.

const CACHE_NAME = "brio-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Skip Supabase / API calls
  if (url.hostname.includes("supabase.co") || url.hostname.includes("supabase.in")) return;

  // Network-first per HTML e app.js (sempre l'ultima versione)
  if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname === "/app.js") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first per il resto
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, clone));
      return res;
    }))
  );
});
