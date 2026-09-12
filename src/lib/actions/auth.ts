"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthResult = { error?: string };

export async function signUp(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const yearId = String(formData.get("year_id") ?? "");

  if (!fullName || !email || !password || !yearId) {
    return { error: "All fields are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    // handle_new_user() creates the profile + pending enrollment from this metadata
    options: { data: { full_name: fullName, year_id: yearId } },
  });

  if (error) return { error: error.message };
  redirect("/pending");
}

export async function signIn(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password." };

  // Layer 1 portal session: newest login wins (docs/permissions.md).
  await supabase.rpc("register_session");
  await supabase.auth.signOut({ scope: "others" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .single();

  redirect(
    next && next.startsWith("/")
      ? next
      : profile?.role === "admin"
        ? "/admin"
        : "/dashboard"
  );
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
