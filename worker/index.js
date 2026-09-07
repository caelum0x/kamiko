/*
 * $KAMIKO service worker — renders streak-saver push notifications and focuses the game on click.
 *
 * The payload shape is exactly what services/game-api/push.ts sends
 * ({ title, body, url } — see `nudgeMessage` and `NudgeSender`), and every field has a fallback:
 * a push that arrives with an unreadable body must still show SOMETHING, because a browser that
 * receives a push and shows no notification revokes the site's push permission.
 *
 * WHY THIS LIVES IN worker/ AND NOT public/sw.js: amica builds with @ducanh2912/next-pwa configured
 * as `dest: "public"` (next.config.js), which GENERATES public/sw.js on every build. A hand-written
 * public/sw.js is therefore deleted by the next `npm run build` — the push worker would work in
 * development and silently vanish in production, which is the worst shape a bug can have.
 *
 * next-pwa's custom-worker hook is the supported seam: it compiles `worker/index.js` and imports it
 * into the worker it generates, so these handlers ship INSIDE the same /sw.js that does amica's
 * offline caching. One registration, one scope. Registering a second worker at '/' would replace
 * amica's PWA registration outright, which is why src/npc/push.ts registers '/sw.js' and nothing else.
 */
self.addEventListener('push', (event) => {
  const data = { title: '👁️ $KAMIKO', body: 'come wake her', url: '/game' };
  try {
    if (event.data) {
      const j = event.data.json();
      if (j && typeof j === 'object') {
        if (typeof j.title === 'string' && j.title) data.title = j.title;
        if (typeof j.body === 'string' && j.body) data.body = j.body;
        if (typeof j.url === 'string' && j.url) data.url = j.url;
      }
    }
  } catch (e) {
    /* an unreadable payload still gets the default notification, never silence */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      tag: 'npc-streak-saver',
      renotify: true,
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/game';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        // Same-origin tab already open: focus it and take it to the game rather than opening a
        // second copy of the app.
        if ('focus' in w) {
          if ('navigate' in w) { try { return w.navigate(url).then(() => w.focus()); } catch (e) { /* fall through */ } }
          return w.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }),
  );
});
