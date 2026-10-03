/**
 * PWA cold-start budgets. Public navigations (especially start_url "/") must
 * not wait indefinitely for Auth token refresh on slow mobile data.
 *
 * Protected routes still fully await getClaims() — security is unchanged.
 */

/** Max time proxy waits for getClaims() on public paths before returning HTML. */
export const PUBLIC_AUTH_REFRESH_BUDGET_MS = 450;

/**
 * Max time the start splash waits for a local/client session decision before
 * revealing the public landing (authenticated users still reach /dashboard
 * via Sign in if the race lost to a slow network).
 */
export const PWA_START_SESSION_BUDGET_MS = 2000;

export type RaceResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

/** Race a promise against a timeout. Does not cancel the underlying work. */
export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<RaceResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, ms);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Treat rejection like a timeout for startup — caller proceeds without claims.
        resolve({ timedOut: true });
      }
    );
  });
}

/** Public paths where HTML paint must not wait on Auth refresh. */
export function isPublicStartupPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/offline") ||
    pathname.startsWith("/api/cron") ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/health/") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icons/")
  );
}
