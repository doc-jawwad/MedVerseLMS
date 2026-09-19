import type { NextRequest } from "next/server";

/**
 * Public origin for redirects behind Caddy.
 *
 * Root cause of localhost redirects: when Caddy reverse_proxies to Next without
 * `header_up Host {host}`, `new URL(request.url).origin` becomes
 * `http://localhost:3000` (or 127.0.0.1). Prefer, in order:
 * 1) configured public app URL (NEXT_PUBLIC_SUPABASE_URL is the Caddy origin)
 * 2) X-Forwarded-Host / Host when not loopback
 * 3) request.url origin (local dev)
 */
function isLoopbackHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

function originFromConfigured(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "";
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (isLoopbackHost(u.hostname)) return null;
    // Cloud Auth project URL is not the LMS origin — skip *.supabase.co
    if (u.hostname.endsWith(".supabase.co")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function getPublicOrigin(request: NextRequest): string {
  const configured = originFromConfigured();
  if (configured) return configured;

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const hostHeader = request.headers.get("host")?.trim() ?? "";
  const host = forwardedHost || hostHeader;

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();

  if (host && !isLoopbackHost(host)) {
    const proto =
      forwardedProto === "http" || forwardedProto === "https"
        ? forwardedProto
        : "https";
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}
