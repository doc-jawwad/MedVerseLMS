import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";

// Server-side landing point for email links that carry a token_hash (password
// recovery). Verifying here (not client-side) lets the SSR client persist the
// resulting session into cookies before redirecting to the page that uses it.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      const { error: profileError } = await supabase.rpc("ensure_profile");
      if (profileError) {
        return NextResponse.redirect(`${origin}/login?reason=profile`);
      }

      if (type === "signup") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, account_status")
          .single();
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

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?reason=link_invalid`);
}
