/*
 * $KAMIKO — service-worker KILL SWITCH (kamiko.fun).
 *
 * kamiko.fun is a single-page consumer site. Earlier builds registered a workbox precache service
 * worker that could keep serving a STALE app shell to returning browsers — the reason a visitor
 * still saw the old, route-changing navigation after the site had been rebuilt as one page.
 *
 * This script is deployed to /sw.js for that site (next-pwa is disabled for the build, so nothing
 * generates a competing worker). A browser that still has the old worker registered fetches this
 * new /sw.js on its next update check, installs it, and on activation it:
 *   1. deletes every Cache Storage entry (the stale precache), then
 *   2. unregisters itself, then
 *   3. reloads every open tab
 * so the visitor drops to the current network app and no stale bundle is ever served again. New
 * visitors never register any worker (nothing calls register()), so this file is inert for them.
 *
 * There is deliberately NO fetch handler: with none, the browser goes straight to the network for
 * every request while this worker is briefly alive, so nothing is served from cache.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (_) {
        /* best effort — a browser without Cache Storage has nothing to clear */
      }
      try {
        await self.registration.unregister();
      } catch (_) {
        /* best effort */
      }
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          try {
            client.navigate(client.url);
          } catch (_) {
            /* a client that refuses navigation will still get the fresh app on its next load */
          }
        }
      } catch (_) {
        /* best effort */
      }
    })(),
  );
});
