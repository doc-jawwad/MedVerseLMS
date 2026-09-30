import "server-only";

import { redirect } from "next/navigation";
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

  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    redirect(nextPath);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .single();

  redirect(profile?.role === "admin" ? "/admin" : "/dashboard");
}
