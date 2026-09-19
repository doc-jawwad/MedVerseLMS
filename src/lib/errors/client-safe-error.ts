/**
 * Client-safe mapping of Auth/DB/RPC failures to display strings.
 * Safe to import from Client Components (no server-only).
 */

const GENERIC = "Something went wrong. Please try again.";

const LOOKS_LIKE_INTERNAL =
  /violat(e|es|ion)|relation |column |syntax error|permission denied for|duplicate key|foreign key|jwt|stack|exception|postgres|supabase|internal server|econnrefused|timeout|rls policy/i;

export function isSafeBusinessErrorCode(value: string): boolean {
  const t = value.trim();
  if (!t || t.length > 80) return false;
  if (LOOKS_LIKE_INTERNAL.test(t)) return false;
  return /^[a-z][a-z0-9_]{1,64}$/i.test(t);
}

/** Map a raw PostgREST/Auth message to a safe client string (no logging). */
export function sanitizeClientErrorMessage(
  raw: string | null | undefined,
  fallback: string = GENERIC
): string {
  const t = (raw ?? "").trim();
  if (t && isSafeBusinessErrorCode(t)) return t.toLowerCase();
  return fallback;
}
