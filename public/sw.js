const CACHE_VERSION = "plottrust-v3";
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const API_CACHE = `${CACHE_VERSION}-api`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  "/portal",
  "/vendor",
  "/purchases",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon.svg",
  "/maskable-icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

const APP_SHELL_ROUTES = new Set(["/", "/portal", "/vendor", "/purchases"]);

function shouldCache(response) {
  return response && (response.ok || response.type === "opaque");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))).then(() =>
        self.skipWaiting()
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (!key.startsWith(CACHE_VERSION)) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf)$/i.test(
      url.pathname
    );
  const isApiRequest = url.pathname.startsWith("/api/");

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const pageCache = await caches.open(PAGE_CACHE);
        try {
          const preloaded = await event.preloadResponse;
          const networkResponse = preloaded || (await fetch(request));
          if (shouldCache(networkResponse)) {
            pageCache.put(request, networkResponse.clone());
            if (APP_SHELL_ROUTES.has(url.pathname)) {
              pageCache.put(url.pathname, networkResponse.clone());
            }
          }
          return networkResponse;
        } catch {
          const cachedPage = await pageCache.match(request);
          if (cachedPage) return cachedPage;
          if (APP_SHELL_ROUTES.has(url.pathname)) {
            const shellPage = await pageCache.match(url.pathname);
            if (shellPage) return shellPage;
          }
          const offline = await caches.match(OFFLINE_URL);
          return offline || Response.error();
        }
      })()
    );
    return;
  }

  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (shouldCache(response)) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);
        return cached || networkPromise || Response.error();
      })()
    );
    return;
  }

  if (isApiRequest) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        try {
          const response = await fetch(request);
          if (shouldCache(response)) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await cache.match(request);
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => Response.error());
    })
  );
});
