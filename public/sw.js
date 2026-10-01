const CACHE_NAME = "lets-get-faded-admin-v1";
const ADMIN_ASSETS = [
  "/admin",
  "/admin.html",
  "/admin.css",
  "/admin.js",
  "/admin-manifest.json",
  "/logo.jpg",
];
const ADMIN_ASSET_PATHS = new Set(ADMIN_ASSETS);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ADMIN_ASSETS))
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    !ADMIN_ASSET_PATHS.has(requestUrl.pathname)
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
      return event.request.mode === "navigate" ? caches.match("/admin") : Response.error();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name.startsWith("lets-get-faded-admin-") && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
});
