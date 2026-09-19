/**
 * Safe PWA cache rules. The service worker in public/sw.js must stay in
 * lockstep with these helpers — unit tests read both.
 *
 * Cache only hashed Next static files and public branding. Never intercept
 * HTML/RSC, PostgREST, Auth, signed R2 URLs, exam payloads, or API routes.
 */
export const PWA_CACHE_NAME = "medverse-static-v1";
export const PWA_SW_PATH = "/sw.js";

export const PWA_CACHEABLE_PATH_PREFIXES = ["/_next/static/", "/icons/"] as const;

export const PWA_CACHEABLE_PATHS = [
  "/logo-icon.png",
  "/logo-full.png",
] as const;

export const PWA_NEVER_CACHE_PATH_PREFIXES = [
  "/rest/v1",
  "/auth/v1",
  "/storage/v1",
  "/functions/v1",
  "/api/",
] as const;

const EXAM_ATTEMPT_PATH = /\/tests\/[^/]+\/attempt(?:\/|$)/;
const EXAM_PREVIEW_PATH = /\/tests\/[^/]+\/preview(?:\/|$)/;

export function isExamChromePath(pathname: string): boolean {
  return EXAM_ATTEMPT_PATH.test(pathname) || EXAM_PREVIEW_PATH.test(pathname);
}

export function isSignedOrPrivateObjectUrl(url: URL): boolean {
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

export function isNeverCacheRequest(input: {
  method: string;
  url: string;
  mode?: string;
  destination?: string;
}): boolean {
  if (input.method.toUpperCase() !== "GET") return true;
  if (input.mode === "navigate" || input.destination === "document") {
    return true;
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return true;
  }
  if (url.searchParams.has("_rsc")) return true;
  if (input.destination === "document") return true;
  const path = url.pathname;
  if (PWA_NEVER_CACHE_PATH_PREFIXES.some((p) => path.startsWith(p))) {
    return true;
  }
  if (isExamChromePath(path)) return true;
  if (isSignedOrPrivateObjectUrl(url)) return true;
  if (path.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

export function isCacheableStaticAsset(input: {
  method: string;
  url: string;
  destination?: string;
}): boolean {
  if (isNeverCacheRequest(input)) return false;
  if (input.method.toUpperCase() !== "GET") return false;
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return false;
  }
  if (input.destination === "document") return false;
  const path = url.pathname;
  if (PWA_CACHEABLE_PATH_PREFIXES.some((p) => path.startsWith(p))) return true;
  return (PWA_CACHEABLE_PATHS as readonly string[]).includes(path);
}
