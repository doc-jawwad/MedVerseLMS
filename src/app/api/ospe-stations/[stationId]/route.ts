import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getR2Object } from "@/lib/r2/presign";

export const runtime = "nodejs";

/**
 * Entitlement-checked OSPE station image bytes.
 * Browser never receives a public or signed R2 URL — authorize then stream.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ stationId: string }> }
) {
  const { stationId } = await context.params;
  if (!stationId) {
    return NextResponse.json({ error: "ospe_object_denied" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc(
    "authorize_ospe_station_object",
    { p_station_id: stationId }
  );
  if (error || typeof key !== "string" || !key) {
    return NextResponse.json({ error: "ospe_object_denied" }, { status: 403 });
  }

  const object = await getR2Object({ key });
  if ("error" in object) {
    return NextResponse.json({ error: object.error }, { status: 502 });
  }

  const contentType =
    object.contentType && object.contentType.startsWith("image/")
      ? object.contentType
      : "image/jpeg";

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
