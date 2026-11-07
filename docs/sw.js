// Service worker: offline app shell + reminder notification clicks.
const CACHE = "nudge-v5";
const SHELL = ["./", "index.html", "login.html", "config.js", "auth.js", "app.js", "nlp.js", "extras.js", "style.css", "manifest.webmanifest",
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
  if (e.request.headers.has("range") || new URL(e.request.url).pathname.includes("/media/")) return; // let video stream normally
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
  const { id, briefing } = e.notification.data || {};
  const action = briefing ? "briefing" : e.action || "open";
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      wins[0].postMessage({ type: "reminder-action", id, action });
      return wins[0].focus();
    }
    return self.clients.openWindow(briefing ? "./?action=briefing" : `./?task=${id}&action=${action}`);
  })());
});

// Push messages from the companion server (reminders that fire while the app is closed).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Reminder", body: e.data ? e.data.text() : "" }; }
  const briefing = d.kind === "briefing";
  e.waitUntil(self.registration.showNotification(d.title || "⏰ Reminder", {
    body: d.body || "", tag: d.tag || "reminder", renotify: true, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    requireInteraction: Boolean(d.nag || d.priority === "high"), vibrate: [200, 100, 200, 100, 300],
    data: briefing ? { briefing: true } : { id: d.id },
    actions: briefing ? [] : [{ action: "done", title: "Done" }, { action: "snooze", title: "Snooze 10 min" }],
  }));
});
