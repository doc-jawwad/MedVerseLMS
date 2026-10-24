import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getR2Object } from "@/lib/r2/presign";

export const runtime = "nodejs";

/**
 * Entitlement-checked Prof. Session one-liner source PDF bytes.
 * Browser never receives a public or signed R2 URL — authorize then stream.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: "one_liner_object_denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc("authorize_one_liner_object", {
    p_one_liner_id: id,
  });
  if (error || typeof key !== "string" || !key) {
    return NextResponse.json(
      { error: "one_liner_object_denied" },
      { status: 403 }
    );
  }

  const object = await getR2Object({ key });
  if ("error" in object) {
    return NextResponse.json({ error: object.error }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
