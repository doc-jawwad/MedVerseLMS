import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicOrigin } from "@/lib/http/public-origin";
import {
  handleRecoveryConfirmPost,
  renderRecoveryConfirmPage,
} from "@/lib/auth/recovery-confirm";

// Password-recovery landing. GET/HEAD only render a confirmation page: email
// scanners and previewers hit these and a Supabase recovery token is one-time,
// so verifyOtp runs only on the user's explicit POST (Continue button).
export async function GET(request: NextRequest) {
  return renderRecoveryConfirmPage(new URL(request.url), "GET");
}

export async function HEAD(request: NextRequest) {
  return renderRecoveryConfirmPage(new URL(request.url), "HEAD");
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => new FormData());
  return handleRecoveryConfirmPost({
    form,
    requestOrigin: request.headers.get("origin"),
    publicOrigin: getPublicOrigin(request),
    verify: async (params) => {
      const supabase = await createClient();
      return supabase.auth.verifyOtp(params);
    },
  });
}
