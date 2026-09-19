/** Durable selected-class cookie under `/admin` (httpOnly). */
export const ADMIN_CLASS_COOKIE = "medverse_admin_year";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isYearUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value));
}

export function adminClassCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 180,
    path: "/admin",
  };
}

/**
 * Pure resolver: cookie is the selected-class source of truth.
 * `searchYear` is only a fallback when the cookie is missing (e.g. deep link
 * before the proxy has written the cookie onto the request).
 */
export function resolveAdminClassId(
  cookieYear: string | null | undefined,
  searchYear?: string | null
): string | null {
  if (isYearUuid(cookieYear)) return cookieYear;
  if (isYearUuid(searchYear)) return searchYear;
  return null;
}

/** True when `?year=` is a valid year id that differs from the cookie. */
export function adminClassNeedsSync(
  cookieYear: string | null | undefined,
  searchYear: string | null | undefined
): searchYear is string {
  return isYearUuid(searchYear) && searchYear !== cookieYear;
}
