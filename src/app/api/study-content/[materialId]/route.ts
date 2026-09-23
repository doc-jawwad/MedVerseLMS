import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchR2ObjectStream,
  headR2ObjectViaPresign,
} from "@/lib/r2/presign";

export const runtime = "nodejs";

/**
 * Entitlement-checked PDF bytes with HTTP Range support.
 * Streams from private R2 — does not buffer the whole object in Node.
 * The browser never receives an R2 URL or credentials.
 */
async function authorizeKey(materialId: string) {
  if (!materialId) return null;
  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc("authorize_study_object", {
    p_material_id: materialId,
  });
  if (error || typeof key !== "string" || !key) return null;
  return key;
}

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/pdf",
  "Content-Disposition": 'inline; filename="study-material.pdf"',
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "bytes",
  // Discourage Save-as / attachment UX in some UAs
  "X-Robots-Tag": "noindex, nofollow",
};

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ materialId: string }> }
) {
  const { materialId } = await context.params;
  const key = await authorizeKey(materialId);
  if (!key) {
    return NextResponse.json({ error: "study_object_denied" }, { status: 403 });
  }
  const head = await headR2ObjectViaPresign({ key });
  if ("error" in head) {
    return NextResponse.json({ error: head.error }, { status: 502 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: {
      ...COMMON_HEADERS,
      "Content-Length": String(head.contentLength),
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ materialId: string }> }
) {
  const { materialId } = await context.params;
  const key = await authorizeKey(materialId);
  if (!key) {
    return NextResponse.json({ error: "study_object_denied" }, { status: 403 });
  }

  const rangeHeader = request.headers.get("range");
  // Unscoped GET would stream the entire object through Next/Caddy and can
  // starve PDF.js Range requests on large files. Answer with a small leading
  // 206 so clients learn Content-Length via Content-Range and continue with Range.
  const effectiveRange = rangeHeader || "bytes=0-65535";
  const upstream = await fetchR2ObjectStream({
    key,
    rangeHeader: effectiveRange,
  });
  if ("error" in upstream) {
    return NextResponse.json({ error: upstream.error }, { status: 502 });
  }

  const headers = new Headers(COMMON_HEADERS);
  const pass = [
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ] as const;
  for (const name of pass) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has("accept-ranges")) {
    headers.set("Accept-Ranges", "bytes");
  }

  // Stream body through — do not arrayBuffer().
  return new NextResponse(upstream.body, {
    status: upstream.status === 200 && !rangeHeader ? 206 : upstream.status,
    headers,
  });
}
