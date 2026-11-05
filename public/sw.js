/* Tinta service worker — deliberately small and conservative.
 * - Static build assets: cache-first (immutable, hashed).
 * - Scan screen: network-first with a cached copy, so a dropped connection mid-scan keeps working
 *   (captures themselves live in IndexedDB and upload later).
 * - Never caches API routes, auth, student share links or other teacher pages (private, must be fresh).
 * - Offline fallback page for everything else.
 */
const VERSION = "tinta-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC).then((c) => c.addAll([OFFLINE_URL, "/icons/icon.svg", "/icons/icon-192.png"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Sent on sign-in/sign-out: drop any cached teacher pages.
  if (event.data === "clear-private") event.waitUntil(caches.delete(PAGES));
});

const isScanPage = (url) => /^\/assignments\/[0-9a-f-]{36}\/scan$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/s/") || url.pathname.startsWith("/auth/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(STATIC).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && isScanPage(url)) caches.open(PAGES).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (isScanPage(url) && (await caches.match(req))) || (await caches.match(OFFLINE_URL))),
    );
  }
});
