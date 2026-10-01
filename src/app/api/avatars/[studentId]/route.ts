import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getR2Object } from "@/lib/r2/presign";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Entitlement-checked avatar bytes.
 * Browser never receives a public or signed R2 URL — authorize then stream.
 * Use studentId === "me" for the caller's own avatar.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ studentId: string }> }
) {
  const { studentId } = await context.params;
  if (!studentId) {
    return NextResponse.json({ error: "avatar_forbidden" }, { status: 403 });
  }

  const isSelf = studentId === "me";
  if (!isSelf && !UUID_RE.test(studentId)) {
    return NextResponse.json({ error: "avatar_forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc("authorize_avatar_object", {
    p_student_id: isSelf ? null : studentId,
  });
  if (error || typeof key !== "string" || !key) {
    const msg =
      typeof error?.message === "string" && error.message.includes("avatar_not_found")
        ? "avatar_not_found"
        : "avatar_forbidden";
    const status = msg === "avatar_not_found" ? 404 : 403;
    return NextResponse.json({ error: msg }, { status });
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
