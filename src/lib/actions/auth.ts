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
  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
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
  if (error) {
    if (error.message.toLowerCase().includes("email not confirmed")) {
      redirect(`/verify-email?email=${encodeURIComponent(email)}`);
    }
    return { error: "Invalid email or password." };
  }

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

// --- Email verification (signup code) ---

export async function verifySignupCode(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!email || token.length !== 6) {
    return { error: "Enter the 6-digit code from your email." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "signup",
  });
  if (error) return { error: "That code is invalid or has expired." };

  // Verifying establishes a session too; register it under the single-session policy.
  await supabase.rpc("register_session");
  redirect("/pending");
}

export async function resendSignupCode(email: string): Promise<AuthResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) return { error: error.message };
  return {};
}

// --- Forgot password ---

export async function requestPasswordReset(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };

  // The recovery.html template builds its own link (SiteURL + /auth/confirm)
  // directly from {{ .TokenHash }}, so no redirectTo option is needed here.
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  // Never reveal whether the email exists — same response either way.
  if (error && !error.message.toLowerCase().includes("rate limit")) {
    return {};
  }
  return {};
}

export async function updatePassword(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  await supabase.rpc("register_session");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .single();
  redirect(profile?.role === "admin" ? "/admin" : "/dashboard");
}
