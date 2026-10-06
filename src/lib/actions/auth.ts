"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  classifySignUpResult,
  formatSignUpAuthErrorForLog,
  isEmailSendRateLimited,
  isExplicitUserAlreadyRegistered,
  SIGNUP_EMAIL_RATE_LIMIT_FAIL,
} from "@/lib/auth/signup-result";
import { reportServerException } from "@/lib/observability/report-server-exception";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";
import {
  clearVerifyEmailCookie,
  setVerifyEmailCookie,
} from "@/lib/auth/verify-email-cookie";
import {
  clientActionFailed,
  logServerError,
  toClientActionError,
} from "@/lib/errors/safe-action-error";
import { passwordRecoveryRedirectTo } from "@/lib/auth/password-recovery";
import { configuredPublicOrigin } from "@/lib/http/public-origin";
import { safeInternalPath } from "@/lib/http/safe-internal-path";

export type AuthResult = { error?: string };

const PROFILE_FAIL = "Could not finish signing in. Please try again.";
const PASSWORD_FAIL = "Could not update your password. Please try again.";
const RESEND_FAIL = "Could not resend the code. Please try again.";

async function ensureProfile(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | undefined> {
  const { error } = await supabase.rpc("ensure_profile");
  if (!error) return undefined;
  return toClientActionError(error, "ensureProfile", PROFILE_FAIL);
}

export async function signUp(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const yearId = String(formData.get("year_id") ?? "");
  const contactNumber = String(formData.get("contact_number") ?? "").trim();
  const collegeName = String(formData.get("college_name") ?? "").trim();

  if (!fullName || !email || !password || !yearId || !contactNumber || !collegeName) {
    return { error: "All fields are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (contactNumber.replace(/[\s()-]/g, "").length < 7) {
    return { error: "Enter a valid contact number." };
  }
  if (collegeName.length < 2) {
    return { error: "Enter your college name." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // user_metadata: ensure_profile reads full_name, year_id, college_name
    // (promotes college into profiles.college_name for leaderboard).
    // contact_number stays Auth-metadata-only (no profiles column).
    options: {
      data: {
        full_name: fullName,
        year_id: yearId,
        contact_number: contactNumber,
        college_name: collegeName,
      },
    },
  });

  // Observability only — client-facing classification stays sanitized below.
  if (error) {
    logServerError("signUp", formatSignUpAuthErrorForLog(error));
    if (!isExplicitUserAlreadyRegistered(error)) {
      reportServerException("signUp", formatSignUpAuthErrorForLog(error), {
        code: error.code ?? null,
        status: error.status ?? null,
      });
    }
  }

  const classified = classifySignUpResult({
    user: data.user,
    session: data.session,
    error,
  });

  if (classified.outcome === "error") {
    return { error: classified.message };
  }
  if (classified.outcome === "existing_verified") {
    redirect("/login?reason=exists");
  }

  // Confirmations-off / already-sessioned signup: provision immediately.
  // Confirmations-on: no JWT yet; verifySignupCode / auth/confirm will provision.
  if (classified.outcome === "session") {
    const profileError = await ensureProfile(supabase);
    if (profileError) return { error: profileError };
  }

  // Carry email via httpOnly cookie — never put it in the URL query string.
  await setVerifyEmailCookie(email);
  redirect("/verify-email");
}

export async function signIn(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeInternalPath(String(formData.get("next") ?? ""), "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.toLowerCase().includes("email not confirmed")) {
      await setVerifyEmailCookie(email);
      redirect("/verify-email");
    }
    return { error: "Invalid email or password." };
  }

  const profileError = await ensureProfile(supabase);
  if (profileError) return { error: profileError };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return { error: PROFILE_FAIL };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", userId)
    .maybeSingle();

  if (isBlockedAccountStatus(profile?.account_status)) {
    await supabase.auth.signOut({ scope: "others" });
    redirect(`/pending?state=${profile?.account_status}`);
  }

  // Layer 1 portal session: newest login wins (docs/permissions.md).
  await supabase.rpc("register_session");
  await supabase.auth.signOut({ scope: "others" });

  redirect(
    next
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
  if (error) {
    logServerError("verifySignupCode", error.message);
    return { error: "That code is invalid or has expired." };
  }

  const profileError = await ensureProfile(supabase);
  if (profileError) return { error: profileError };

  await clearVerifyEmailCookie();
  // Verifying establishes a session too; register it under the single-session policy.
  await supabase.rpc("register_session");
  redirect("/dashboard");
}

export async function resendSignupCode(email: string): Promise<AuthResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) {
    if (isEmailSendRateLimited(error)) {
      logServerError("resendSignupCode", formatSignUpAuthErrorForLog(error));
      reportServerException(
        "resendSignupCode",
        formatSignUpAuthErrorForLog(error),
        { code: error.code ?? null, status: error.status ?? null }
      );
      return { error: SIGNUP_EMAIL_RATE_LIMIT_FAIL };
    }
    return clientActionFailed("resendSignupCode", error, RESEND_FAIL);
  }
  return {};
}

// --- Forgot password ---

export async function requestPasswordReset(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };

  // Custom recovery.html links to /auth/confirm?token_hash=…&type=recovery.
  // Default Auth ConfirmationURL uses redirectTo after Cloud /auth/v1/verify
  // (hash or code on the app origin) — land on the password update page.
  const supabase = await createClient();
  const origin = configuredPublicOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(
    email,
    origin ? { redirectTo: passwordRecoveryRedirectTo(origin) } : undefined
  );
  // Never reveal whether the email exists — same response either way.
  if (error && !error.message.toLowerCase().includes("rate limit")) {
    logServerError("requestPasswordReset", error.message);
    return {};
  }
  return {};
}

export async function updatePassword(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return clientActionFailed("updatePassword", error, PASSWORD_FAIL);
  }

  const profileError = await ensureProfile(supabase);
  if (profileError) return { error: profileError };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return { error: PROFILE_FAIL };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", userId)
    .maybeSingle();

  if (isBlockedAccountStatus(profile?.account_status)) {
    await supabase.auth.signOut({ scope: "others" });
    redirect(`/pending?state=${profile?.account_status}`);
  }

  await supabase.rpc("register_session");

  redirect(profile?.role === "admin" ? "/admin" : "/dashboard");
}

// Voluntary password change from within the app (My Account) — unlike
// updatePassword above, this stays on the page and doesn't touch the
// session, since the user is already fully authenticated.
export async function changePassword(
  _prev: AuthResult | undefined,
  formData: FormData
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return clientActionFailed("changePassword", error, PASSWORD_FAIL);
  }
  return {};
}
