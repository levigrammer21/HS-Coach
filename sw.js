const CACHE = "hs-football-shell-1.2";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data.js",
  "./engine.js",
  "./tactics.js",
  "./special-teams.js",
  "./film-analysis.js",
  "./rules.js",
  "./franchise.js",
  "./storage.js",
  "./render.js",
  "./cloud.js",
  "./sync.js",
  "./football.js",
  "./play-art.js",
  "./formations.js",
  "./statistics.js",
  "./payload.js",
  "./wire.js",
  "./migration.js",
  "./firebase-config.js",
  "./sim-worker.js",
  "./icon.svg",
  "./manifest.webmanifest",
];
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("hs-football-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  // One installed shell is one simulation version. Mixing network-fresh modules
  // with an older cached engine can otherwise break offline turns after an update.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      if (e.request.mode === "navigate") {
        const index = await cache.match(
          new URL("./index.html", self.registration.scope).href,
        );
        if (index) return index;
      }
      return fetch(e.request);
    }),
  );
});
