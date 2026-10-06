import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";
import {
  isPasswordRecoveryOtpType,
  passwordRecoveryNextPath,
} from "@/lib/auth/password-recovery";
import { getPublicOrigin } from "@/lib/http/public-origin";
import { safeInternalPath } from "@/lib/http/safe-internal-path";
import { logServerError } from "@/lib/errors/safe-action-error";

// Server-side landing for email links with token_hash (recovery + optional
// signup). Verifying here persists the SSR session cookie before redirect.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getPublicOrigin(request);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Recovery: session is enough to show /reset-password. Do not call
      // ensure_profile here — RPC failure used to send users to
      // /login?reason=profile after a successful verifyOtp.
      if (isPasswordRecoveryOtpType(type)) {
        const next = passwordRecoveryNextPath(searchParams.get("next"));
        return NextResponse.redirect(`${origin}${next}`);
      }

      const { error: profileError } = await supabase.rpc("ensure_profile");
      if (profileError) {
        logServerError("auth.confirm.ensure_profile", profileError.message);
        return NextResponse.redirect(`${origin}/login?reason=profile`);
      }

      if (type === "signup") {
        const { data: claimsData } = await supabase.auth.getClaims();
        const userId = claimsData?.claims?.sub as string | undefined;
        const { data: profile } = userId
          ? await supabase
              .from("profiles")
              .select("role, account_status")
              .eq("id", userId)
              .maybeSingle()
          : { data: null };
        if (isBlockedAccountStatus(profile?.account_status)) {
          return NextResponse.redirect(
            `${origin}/pending?state=${profile?.account_status}`
          );
        }
        await supabase.rpc("register_session");
        const dest =
          profile?.role === "admin" ? "/admin" : "/dashboard";
        return NextResponse.redirect(`${origin}${dest}`);
      }

      const next = safeInternalPath(searchParams.get("next"), "/");
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?reason=link_invalid`);
}
