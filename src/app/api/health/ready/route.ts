import { NextResponse, type NextRequest } from "next/server";
import { authorizeReady, postgrestProbeUrl } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Postgres + PostgREST reachability. Not a public monitor URL.
// Allow: loopback (systemd/Caddy on the host) or Authorization: Bearer $CRON_SECRET.
export async function GET(request: NextRequest) {
  const allowed = authorizeReady({
    host: request.headers.get("host"),
    xForwardedFor: request.headers.get("x-forwarded-for"),
    authorization: request.headers.get("authorization"),
    cronSecret: process.env.CRON_SECRET,
  });
  if (!allowed) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const probe = postgrestProbeUrl({
    internalUrl: process.env.POSTGREST_INTERNAL_URL,
    publicSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (!probe) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  try {
    const res = await fetch(probe, {
      method: "GET",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Accept: "application/openapi+json",
      },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } }
  );
}
