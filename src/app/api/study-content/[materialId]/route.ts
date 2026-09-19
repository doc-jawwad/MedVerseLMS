import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getR2Object } from "@/lib/r2/presign";

export const runtime = "nodejs";

/**
 * Entitlement-checked PDF bytes. The browser never receives a permanent
 * (or even short-lived) R2 URL — Next.js authorizes, signs, and streams.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ materialId: string }> }
) {
  const { materialId } = await context.params;
  if (!materialId) {
    return NextResponse.json({ error: "study_object_denied" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc("authorize_study_object", {
    p_material_id: materialId,
  });
  if (error || typeof key !== "string" || !key) {
    return NextResponse.json({ error: "study_object_denied" }, { status: 403 });
  }

  const object = await getR2Object({ key });
  if ("error" in object) {
    return NextResponse.json({ error: object.error }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"study-material.pdf\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
