// Service worker: caches the app shell so the web app installs and opens offline.
// Messages/files always come live from Supabase (never cached here).
const CACHE = "bluevane-shell-v1";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./ui.js", "./theme.js", "./themes.js", "./crypto.js", "./config.js", "./favicon.svg", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  const isLib = url.hostname === "cdn.jsdelivr.net";
  if (!sameOrigin && !isLib) return;               // Supabase API, storage, avatars: always network
  e.respondWith(
    fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
