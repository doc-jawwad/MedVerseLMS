/**
 * Explicit Supabase SSR auth cookie attributes (M3/L1).
 *
 * @supabase/ssr browser storage reads/writes via document.cookie, so HttpOnly
 * MUST remain false — enabling it breaks client refresh, SessionWatch, and
 * client-side RPC auth. Secure/SameSite/Path are set explicitly.
 */
export function supabaseAuthCookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    // Required by @supabase/ssr createBrowserClient document.cookie storage.
    httpOnly: false,
    // Production Next builds (staging + prod HTTPS). Local next dev stays false.
    secure: process.env.NODE_ENV === "production",
  };
}
