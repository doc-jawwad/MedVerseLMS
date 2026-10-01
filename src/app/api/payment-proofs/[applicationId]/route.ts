import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getR2Object } from "@/lib/r2/presign";

export const runtime = "nodejs";

/**
 * Entitlement-checked payment-proof bytes.
 * Browser never receives a public or signed R2 URL — authorize then stream.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ applicationId: string }> }
) {
  const { applicationId } = await context.params;
  if (!applicationId) {
    return NextResponse.json(
      { error: "screenshot_access_denied" },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc(
    "authorize_payment_screenshot_access",
    {
      p_application_id: applicationId,
      p_purpose: "read",
    }
  );
  if (error || typeof key !== "string" || !key) {
    return NextResponse.json(
      { error: "screenshot_access_denied" },
      { status: 403 }
    );
  }

  const object = await getR2Object({ key });
  if ("error" in object) {
    return NextResponse.json({ error: object.error }, { status: 502 });
  }

  const contentType =
    object.contentType &&
    (object.contentType.startsWith("image/") ||
      object.contentType === "application/octet-stream")
      ? object.contentType.startsWith("image/")
        ? object.contentType
        : "image/webp"
      : "image/webp";

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
