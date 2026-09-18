import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseFetch } from "@/lib/supabase/postgrest-fetch";
import {
  SSR_TIMING_LOG_TAG,
  sanitizeSsrTimingToken,
  ssrTimingEnabled,
} from "@/lib/observability/ssr-timing";

// Next 16 proxy (formerly middleware): refresh the Supabase session cookie and do
// OPTIMISTIC redirects only. Real authorization lives in RLS + layout guards
// (docs/permissions.md); the single-session check runs in requireUser().
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

  // Captured before getClaims() runs: a failed refresh makes the Supabase
  // client's own setAll() callback clear this same cookie from `request`
  // as a side effect, so checking after the call would always see it gone.
  const hadSupabaseSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: supabaseFetch },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: keep this call — it refreshes expired auth tokens.
  const timeProxy =
    ssrTimingEnabled() &&
    (pathname === "/tests" || /\/tests\/[^/]+\/result\/?$/.test(pathname));
  const proxyT0 = timeProxy ? performance.now() : 0;
  const { data } = await supabase.auth.getClaims();
  if (timeProxy) {
    const ms = Math.round((performance.now() - proxyT0) * 10) / 10;
    console.info(
      JSON.stringify({
        tag: SSR_TIMING_LOG_TAG,
        layer: "proxy",
        route: sanitizeSsrTimingToken(pathname, "unknown"),
        req: sanitizeSsrTimingToken(request.headers.get("x-loadtest-req")),
        run: sanitizeSsrTimingToken(request.headers.get("x-loadtest-run")),
        total_ms: ms,
        page_fn_ms: null,
        html_ms: null,
        spans: [{ name: "proxy.getClaims", start_ms: 0, ms }],
      })
    );
  }
  const isAuthed = Boolean(data?.claims);

  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/cron") ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/health/");

  if (!isAuthed && !isPublic) {
    // Built fresh from request.url rather than request.nextUrl.clone(): a
    // real (as opposed to malformed) revoked token makes getClaims() run an
    // actual refresh attempt, whose failed setAll() cookie-deletion mutates
    // `request` — cloning nextUrl afterward was silently dropping params.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    // A stale Supabase auth cookie with no valid claims means this browser
    // *was* signed in and its refresh token was revoked — almost always by
    // signIn()'s `signOut({ scope: "others" })` on a newer login elsewhere
    // (docs/permissions.md Layer 1), not a token that merely expired from
    // sitting idle. getClaims() failing here means requireUser()'s own
    // active_session_id check (which sets reason=kicked) never gets a
    // chance to run, so surface the same reason from the edge instead of
    // falling through to the generic "please sign in" copy.
    if (hadSupabaseSession) {
      loginUrl.searchParams.set("reason", "kicked");
    }
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
