const CACHE_NAME = "lets-get-faded-public-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/logo.jpg",
  "/manifest.json",
];
const ASSET_PATHS = new Set(STATIC_ASSETS);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    !ASSET_PATHS.has(requestUrl.pathname)
  ) return;

  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && response.type === "basic") {
        const responseToCache = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache)));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return event.request.mode === "navigate" ? caches.match("/") : Response.error();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name.startsWith("lets-get-faded-public-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
});
