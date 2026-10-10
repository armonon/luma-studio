// Luma service worker KILL SWITCH.
//
// Deploy this file as /sw.js (overwriting the generated one) to make every
// visitor's browser delete Luma's caches, unregister the worker and reload
// open studio tabs from the network — no app code changes needed.
//
//   npm run build:netlify            # normal build (writes public/sw.js)
//   cp build/kill-switch-sw.js public/sw.js
//   npx -y netlify-cli deploy --build --site 87b9f549-4bb5-4d58-adac-139fe5e1e3e6 ...
//     (or overlay just /sw.js onto the live deploy with the parity method)
//
// /sw.js is served with Cache-Control: no-cache (netlify.toml), so browsers
// see this file on their next navigation instead of a cached old worker.
// Plain JS, zero imports, so it can be dropped in as-is during an incident.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("luma-")).map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
