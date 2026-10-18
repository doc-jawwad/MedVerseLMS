import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicOrigin } from "@/lib/http/public-origin";
import {
  handleRecoveryConfirmGet,
  handleRecoveryConfirmPost,
} from "@/lib/auth/recovery-confirm";

// Password-recovery landing. GET/HEAD never call Auth: email scanners and
// previewers hit these and a Supabase recovery token is one-time, so verifyOtp
// runs only on the user's explicit POST (Continue button).
function get(request: NextRequest, method: "GET" | "HEAD") {
  return handleRecoveryConfirmGet({
    url: new URL(request.url),
    method,
    readCookie: (name) => request.cookies.get(name)?.value,
    secure: getPublicOrigin(request).startsWith("https://"),
  });
}

export async function GET(request: NextRequest) {
  return get(request, "GET");
}

export async function HEAD(request: NextRequest) {
  return get(request, "HEAD");
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => new FormData());
  const publicOrigin = getPublicOrigin(request);
  return handleRecoveryConfirmPost({
    form,
    requestOrigin: request.headers.get("origin"),
    publicOrigin,
    readCookie: (name) => request.cookies.get(name)?.value,
    secure: publicOrigin.startsWith("https://"),
    verify: async (params) => {
      const supabase = await createClient();
      return supabase.auth.verifyOtp(params);
    },
  });
}
