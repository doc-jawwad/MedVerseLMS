import "server-only";

import { redirect } from "next/navigation";
import { safeInternalPath } from "@/lib/http/safe-internal-path";
import { createClient } from "@/lib/supabase/server";

/**
 * If the browser already has a valid Supabase session, send the user into the
 * app (same destinations as sign-in). Used by public shells so PWA start_url="/"
 * and /login do not look logged-out after quit/reopen.
 */
export async function redirectIfAuthenticated(
  nextPath?: string | null
): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return;

  // Canonical open-redirect guard (same as login next= / auth confirm).
  const safeNext = safeInternalPath(nextPath, "");
  if (safeNext) {
    redirect(safeNext);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .single();

  redirect(profile?.role === "admin" ? "/admin" : "/dashboard");
}
