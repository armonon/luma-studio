/* Luma service worker — generated into public/sw.js by build/generate-sw.mjs.
 *
 * Dependency-free on purpose so it can be audited in one read:
 * - Precaches the studio shells (/studio, /iphone, /ipad) and every hashed
 *   /_next/static asset the editor can load (except the 27 MB on-device AI
 *   runtime), plus the default Lato faces, icons and manifest — so the
 *   studio opens, edits and exports offline after the first visit.
 * - Studio navigations are network-first (fresh deploys win while online)
 *   with a 4 s timeout, then the cached copy of that page, then the
 *   precached /studio shell. Other pages on this domain (the marketing site,
 *   /learn, /campaign) are never intercepted.
 * - Never cached: /api/* (the server function), any non-GET request, and
 *   anything cross-origin — except the shared thecreatingco.com suite
 *   menu script, which is kept as a last-known copy so the menu still
 *   renders offline.
 * - /fonts/* and /pdfjs/* (static app assets that load on demand) are kept
 *   after their first use. No user documents are ever stored here; Luma's
 *   own autosave lives in IndexedDB.
 * - Updates never apply mid-session: the waiting worker only activates
 *   when the page posts {type: "SKIP_WAITING"}, which happens only after
 *   the user clicks "Reload" on the in-app update prompt.
 * Kill switch: build/kill-switch-sw.js (see docs/release/pwa.md).
 */
const VERSION = "__LUMA_SW_VERSION__";
const PRECACHE_URLS = __LUMA_PRECACHE__;
const PRECACHE = `luma-precache-${VERSION}`;
const PAGES = "luma-pages-v1";
const ASSETS = "luma-assets-v1";
const SUITE = "luma-suite-v1";
const SUITE_SCRIPT = "https://thecreatingco.com/suite/v1/suite.js";
const SUITE_APPS = "https://thecreatingco.com/suite/v1/apps.json";
const STUDIO_PATHS = new Set(["/studio", "/iphone", "/ipad"]);
const PRECACHED = new Set(PRECACHE_URLS);

const studioPath = (url) => {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return STUDIO_PATHS.has(path) ? path : null;
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    const cached = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    // Reuse identical hashed files from the previous version's cache so an
    // update only downloads what actually changed.
    const previous = (await caches.keys()).filter((name) => name.startsWith("luma-precache-") && name !== PRECACHE);
    const queue = PRECACHE_URLS.filter((url) => !cached.has(url));
    const worker = async () => {
      while (queue.length) {
        const url = queue.shift();
        const immutable = url.startsWith("/_next/static/");
        let response = null;
        if (immutable) for (const name of previous) {
          response = await (await caches.open(name)).match(url);
          if (response) break;
        }
        if (!response) {
          response = await fetch(new Request(url, { cache: "reload", credentials: "same-origin" }));
          if (!response.ok) throw new Error(`precache ${url}: ${response.status}`);
        }
        await cache.put(url, response);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("luma-precache-") && name !== PRECACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function precached(pathname) {
  return (await caches.open(PRECACHE)).match(pathname);
}

async function studioNavigation(request, path) {
  const pages = await caches.open(PAGES);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    if (response.ok && response.type === "basic") pages.put(path, response.clone());
    return response;
  } catch {
    return (await pages.match(path)) || (await precached(path)) || (await precached("/studio")) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") cache.put(request, response.clone());
  return response;
}

async function suiteAsset(request) {
  const cache = await caches.open(SUITE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request.url, response.clone());
    return response;
  } catch {
    return (await cache.match(request.url)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    if (url.href === SUITE_SCRIPT || url.href === SUITE_APPS) event.respondWith(suiteAsset(request));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    const path = studioPath(url);
    if (path) event.respondWith(studioNavigation(request, path));
    return;
  }
  // Hashed build assets are immutable; ignore cache-busting queries on them.
  if (PRECACHED.has(url.pathname) && (!url.search || url.pathname.startsWith("/_next/static/"))) {
    event.respondWith((async () => {
      const hit = await precached(url.pathname);
      if (!hit) return fetch(request);
      const isWorker = request.destination === "worker" || request.destination === "sharedworker";
      if (!url.search && !url.hash && !isWorker) return hit;
      // Turbopack workers read their bootstrap config from ?params= or
      // #params= on their own location. A cached Response carries the cache
      // key's URL, which would become the worker's location; a fresh
      // Response takes the request URL (query and fragment included).
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: hit.headers });
    })());
    return;
  }
  if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/pdfjs/")) {
    event.respondWith(cacheFirst(request, ASSETS));
  }
  // Everything else (RSC payloads, the marketing site's own assets, /learn)
  // is not intercepted at all.
});
