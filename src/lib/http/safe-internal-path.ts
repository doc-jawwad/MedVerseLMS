/**
 * Same-origin path helpers for redirects (auth confirm, login next=, etc.).
 * Rejects open redirects: absolute URLs, protocol-relative //evil, backslashes.
 */

export function isSafeInternalPath(value: string): boolean {
  const path = value.trim();
  if (!path.startsWith("/")) return false;
  // Protocol-relative and scheme-bearing values
  if (path.startsWith("//") || path.includes("://")) return false;
  if (path.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return true;
}

/** Return a safe relative path, or fallback (default "/"). */
export function safeInternalPath(
  value: string | null | undefined,
  fallback = "/"
): string {
  if (value == null) return fallback;
  const path = value.trim();
  if (!path) return fallback;
  return isSafeInternalPath(path) ? path : fallback;
}
