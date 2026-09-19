/* MedVerse PWA service worker.
 *
 * Cache hashed /_next/static assets and public branding only.
 * Do not intercept navigations, RSC, PostgREST, Auth, exam routes,
 * signed R2 objects, PDFs, or API calls — authorization stays server-side.
 *
 * Keep deny/allow lists aligned with src/lib/pwa/cache-policy.ts.
 */
const CACHE_NAME = "medverse-static-v2";

const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/"];
const CACHEABLE_PATHS = ["/logo-icon.png", "/logo-icon-on-dark.png", "/logo-full.png"];
const NEVER_PREFIXES = [
  "/rest/v1",
  "/auth/v1",
  "/storage/v1",
  "/functions/v1",
  "/api/",
];
const EXAM_ATTEMPT = /\/tests\/[^/]+\/attempt(?:\/|$)/;
const EXAM_PREVIEW = /\/tests\/[^/]+\/preview(?:\/|$)/;

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("medverse-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
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

function neverCache(request, url) {
  if (request.method !== "GET") return true;
  if (request.mode === "navigate" || request.destination === "document") {
    return true;
  }
  if (url.searchParams.has("_rsc")) return true;
  const path = url.pathname;
  if (NEVER_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (EXAM_ATTEMPT.test(path) || EXAM_PREVIEW.test(path)) return true;
  if (isSignedOrPrivate(url)) return true;
  if (path.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

function isCacheable(request, url) {
  if (neverCache(request, url)) return false;
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (CACHEABLE_PREFIXES.some((p) => path.startsWith(p))) return true;
  return CACHEABLE_PATHS.includes(path);
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

  if (!isCacheable(request, url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
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
