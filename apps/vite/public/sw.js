/* Art Life Creative Studio — offline service worker.
 * Pages: network first (always get the newest version), cached copy when offline.
 * Scripts, styles, icons, fonts: served from cache instantly, refreshed in the background. */
const CACHE = "artlife-v1.0.7"
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./favicon.svg", "./icon-maskable.svg"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"
  if (!sameOrigin && !isFont) return

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put("./index.html", copy))
          return res
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./"))),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
