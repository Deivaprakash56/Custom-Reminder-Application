// Service worker: offline app shell + reminder notification clicks.
const CACHE = "task-reminder-v1";
const SHELL = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/favicon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates arrive), cache as the offline fallback.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Notification buttons: hand the action to an open app window (or open one).
self.addEventListener("notificationclick", (e) => {
  const { id } = e.notification.data || {};
  const action = e.action || "open";
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      wins[0].postMessage({ type: "reminder-action", id, action });
      return wins[0].focus();
    }
    return self.clients.openWindow(`./?task=${id}&action=${action}`);
  })());
});
