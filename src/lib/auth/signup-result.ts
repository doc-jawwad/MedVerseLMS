/**
 * Classifies supabase.auth.signUp() results without querying auth.users.
 *
 * Confirmations-on (this project):
 * - New / existing-unverified → real user, identities.length >= 1, no session
 * - Existing verified → obfuscated user, identities.length === 0 (or missing)
 *
 * Confirmations-off portability: explicit user_already_exists errors.
 */

export type SignUpUserLike = {
  identities?: ReadonlyArray<unknown> | null;
} | null;

export type SignUpErrorLike = {
  message?: string | null;
  code?: string | null;
} | null;

export type SignUpOutcome =
  | { outcome: "error"; message: string }
  | { outcome: "existing_verified" }
  | { outcome: "needs_verification" }
  | { outcome: "session" };

export function isExplicitUserAlreadyRegistered(
  error: SignUpErrorLike
): boolean {
  if (!error) return false;
  if (error.code === "user_already_exists") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("user already registered");
}

export function classifySignUpResult(input: {
  user: SignUpUserLike;
  session: unknown;
  error: SignUpErrorLike;
}): SignUpOutcome {
  const { user, session, error } = input;

  if (error) {
    if (isExplicitUserAlreadyRegistered(error)) {
      return { outcome: "existing_verified" };
    }
    // Never forward raw Auth/DB text to the browser.
    return {
      outcome: "error",
      message: "Could not create your account. Please try again.",
    };
  }

  if (session) {
    return { outcome: "session" };
  }

  const identities = user?.identities;
  if (!user || identities == null || identities.length === 0) {
    return { outcome: "existing_verified" };
  }

  return { outcome: "needs_verification" };
}
