/* MedVerse PWA service worker.
 *
 * Cache:
 * - hashed /_next/static assets + branding
 * - minimal offline shell navigations: /offline, /offline/read/*
 * - pdf.worker.min.mjs
 *
 * Do NOT cache: APIs, Auth, PostgREST, exam routes, R2, arbitrary pages.
 * Keep deny/allow lists aligned with src/lib/pwa/cache-policy.ts.
 */
const STATIC_CACHE = "medverse-static-v3";
const SHELL_CACHE = "medverse-shell-v1";

const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/"];
const CACHEABLE_PATHS = [
  "/logo-icon.png",
  "/logo-icon-on-dark.png",
  "/logo-full.png",
  "/pdf.worker.min.mjs",
];
const NEVER_PREFIXES = [
  "/rest/v1",
  "/auth/v1",
  "/storage/v1",
  "/functions/v1",
  "/api/",
];
const EXAM_ATTEMPT = /\/tests\/[^/]+\/attempt(?:\/|$)/;
const EXAM_PREVIEW = /\/tests\/[^/]+\/preview(?:\/|$)/;

const PRECACHE_SHELL = ["/offline", "/pdf.worker.min.mjs"];

self.addEventListener("install", (event) => {
  // Do NOT call skipWaiting() here — stay in waiting until the app posts
  // SKIP_WAITING (user tapped "Update now"). Auto-activate races the banner.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        PRECACHE_SHELL.map((p) =>
          fetch(p, { credentials: "same-origin" })
            .then((res) => {
              if (res && res.ok) return cache.put(p, res);
            })
            .catch(() => undefined)
        )
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([STATIC_CACHE, SHELL_CACHE]);
      await Promise.all(
        keys
          .filter((key) => key.startsWith("medverse-") && !keep.has(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "CACHE_OFFLINE_SHELL" && Array.isArray(data.paths)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        for (const p of data.paths) {
          if (typeof p !== "string" || !p.startsWith("/offline")) continue;
          try {
            const res = await fetch(p, { credentials: "same-origin" });
            if (res && res.ok) await cache.put(p, res.clone());
          } catch {
            /* offline */
          }
        }
      })()
    );
  }
});

function isSignedOrPrivate(url) {
  const host = url.hostname.toLowerCase();
  if (
    host.includes("r2.cloudflarestorage.com") ||
    host.endsWith(".r2.dev") ||
    host.includes("cloudflarestorage")
  ) {
    return true;
  }
  const path = url.pathname.toLowerCase();
  if (
    path.includes("payment-proof") ||
    path.includes("payment-proofs") ||
    path.includes("study-content")
  ) {
    return true;
  }
  if (
    url.searchParams.has("X-Amz-Signature") ||
    url.searchParams.has("X-Amz-Credential") ||
    url.searchParams.has("token") ||
    url.searchParams.has("signature")
  ) {
    return true;
  }
  return false;
}

function isOfflineShellPath(pathname) {
  return pathname === "/offline" || pathname.startsWith("/offline/");
}

function neverCache(request, url) {
  if (request.method !== "GET") return true;
  if (url.searchParams.has("_rsc")) return true;
  const path = url.pathname;
  if (NEVER_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (EXAM_ATTEMPT.test(path) || EXAM_PREVIEW.test(path)) return true;
  if (isSignedOrPrivate(url)) return true;
  if (path.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

function isCacheableStatic(request, url) {
  if (neverCache(request, url)) return false;
  if (request.mode === "navigate" || request.destination === "document") {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (CACHEABLE_PREFIXES.some((p) => path.startsWith(p))) return true;
  return CACHEABLE_PATHS.includes(path);
}

function offlineFallbackHtml() {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Offline — MedVerse</title></head><body style="font-family:system-ui;padding:1.5rem"><h1>MedVerse Offline</h1><p>Open <a href="/offline">Offline Library</a> to read saved PDFs.</p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (neverCache(request, url) && !isOfflineShellPath(url.pathname)) return;

  const isNav =
    request.mode === "navigate" || request.destination === "document";

  if (isNav && isOfflineShellPath(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            await cache.put(url.pathname, res.clone());
            await cache.put(request, res.clone());
          }
          return res;
        } catch {
          return (
            (await cache.match(request)) ||
            (await cache.match(url.pathname)) ||
            (await cache.match("/offline")) ||
            offlineFallbackHtml()
          );
        }
      })()
    );
    return;
  }

  if (!isCacheableStatic(request, url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
