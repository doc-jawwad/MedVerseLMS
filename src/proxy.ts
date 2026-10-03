import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_CLASS_COOKIE,
  adminClassCookieOptions,
  adminClassNeedsSync,
} from "@/lib/admin/admin-class";
import { supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookie-options";
import { supabaseFetch } from "@/lib/supabase/postgrest-fetch";
import {
  SSR_TIMING_LOG_TAG,
  sanitizeSsrTimingToken,
  ssrTimingEnabled,
} from "@/lib/observability/ssr-timing";
import {
  applyCspToResponse,
  buildCspHeaderValue,
  resolveCspMode,
} from "@/lib/security/csp";
import {
  PUBLIC_AUTH_REFRESH_BUDGET_MS,
  isPublicStartupPath,
  raceWithTimeout,
} from "@/lib/pwa/startup-budget";

function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

function nextWithPathname(request: NextRequest, pathname: string, nonce: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-medverse-pathname", pathname);
  requestHeaders.set("x-nonce", nonce);

  // Request CSP is always the real policy (with nonce) so Next can extract and
  // attach nonces during SSR. Browser enforcement uses the response header mode.
  const cspValue = buildCspHeaderValue({ nonce });
  requestHeaders.set("Content-Security-Policy", cspValue);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  applyCspToResponse(response, cspValue, resolveCspMode());
  return response;
}

function redirectWithCsp(url: URL, nonce: string) {
  const response = NextResponse.redirect(url);
  const cspValue = buildCspHeaderValue({ nonce });
  applyCspToResponse(response, cspValue, resolveCspMode());
  return response;
}

// Next 16 proxy (formerly middleware): refresh the Supabase session cookie and do
// OPTIMISTIC redirects only. Real authorization lives in RLS + layout guards
// (docs/permissions.md); the single-session check runs in requireUser().
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = createNonce();

  // PWA install assets must not depend on Auth client construction.
  // SW keeps its own narrow CSP from next.config; do not attach app CSP here.
  if (
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icons/")
  ) {
    return NextResponse.next({
      request: {
        headers: (() => {
          const h = new Headers(request.headers);
          h.set("x-medverse-pathname", pathname);
          return h;
        })(),
      },
    });
  }

  let response = nextWithPathname(request, pathname, nonce);

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
      cookieOptions: supabaseAuthCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = nextWithPathname(request, pathname, nonce);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: keep getClaims — it refreshes expired auth tokens.
  // Public paths (PWA start_url "/") must not block HTML on slow Auth refresh.
  const isPublic = isPublicStartupPath(pathname);
  const timeProxy =
    ssrTimingEnabled() &&
    (pathname === "/tests" || /\/tests\/[^/]+\/result\/?$/.test(pathname));
  const proxyT0 = timeProxy ? performance.now() : 0;

  let isAuthed = false;
  if (isPublic) {
    const raced = await raceWithTimeout(
      supabase.auth.getClaims(),
      PUBLIC_AUTH_REFRESH_BUDGET_MS
    );
    if (!raced.timedOut) {
      isAuthed = Boolean(raced.value.data?.claims);
    }
    // On timeout: paint public HTML immediately. Client/session restore continues.
  } else {
    const { data } = await supabase.auth.getClaims();
    isAuthed = Boolean(data?.claims);
  }

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

  if (!isAuthed && !isPublic) {
    // Built fresh from request.url rather than request.nextUrl.clone(): a
    // real (as opposed to malformed) revoked token makes getClaims() run an
    // actual refresh attempt, whose failed setAll() cookie-deletion mutates
    // `request` — cloning nextUrl afterward was silently dropping params.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    // A stale Supabase auth cookie with no valid claims means this browser
    // lost a valid session (refresh revoked or idle expiry). Do not claim
    // another device caused it — requireUser()/session-watch use reason=kicked
    // only when active_session_id actually mismatches.
    if (hadSupabaseSession) {
      loginUrl.searchParams.set("reason", "session_expired");
    }
    return redirectWithCsp(loginUrl, nonce);
  }

  // Admin class SoT: cookie. Sync valid `?year=` onto the cookie so the
  // layout selector and class-scoped pages cannot disagree.
  if (pathname.startsWith("/admin")) {
    const searchYear = request.nextUrl.searchParams.get("year");
    const cookieYear = request.cookies.get(ADMIN_CLASS_COOKIE)?.value;
    if (adminClassNeedsSync(cookieYear, searchYear)) {
      request.cookies.set(ADMIN_CLASS_COOKIE, searchYear);
      response.cookies.set(
        ADMIN_CLASS_COOKIE,
        searchYear,
        adminClassCookieOptions()
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
