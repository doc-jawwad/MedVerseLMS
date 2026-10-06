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
  /** HTTP status when present on AuthApiError (e.g. 429). */
  status?: number | null;
} | null;

export type SignUpOutcome =
  | { outcome: "error"; message: string }
  | { outcome: "existing_verified" }
  | { outcome: "needs_verification" }
  | { outcome: "session" };

/**
 * Strip user-identifying / secret-looking substrings from Auth error text
 * before it hits server logs. Keeps the surrounding diagnostic wording.
 */
export function sanitizeAuthErrorMessageForLog(message: string): string {
  return message
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    // Compact JWT-shaped tokens if Auth ever echoes one in a message.
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[token]"
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Compact Auth failure detail for server logs only.
 * Includes code / status / sanitized message — never raw emails, passwords, or tokens.
 */
export function formatSignUpAuthErrorForLog(error: SignUpErrorLike): string {
  if (!error) return "(no error)";
  const parts: string[] = [];
  if (error.code) parts.push(`code=${error.code}`);
  if (typeof error.status === "number") parts.push(`status=${error.status}`);
  const message = sanitizeAuthErrorMessageForLog((error.message ?? "").trim());
  if (message) parts.push(message);
  return parts.length > 0 ? parts.join(" ") : "(empty Auth error)";
}

export const SIGNUP_GENERIC_FAIL =
  "Could not create your account. Please try again.";

export const SIGNUP_EMAIL_RATE_LIMIT_FAIL =
  "Too many verification emails were sent just now. Wait a few minutes, then try again. If you already registered, check your inbox or wait before requesting another code.";

export function isExplicitUserAlreadyRegistered(
  error: SignUpErrorLike
): boolean {
  if (!error) return false;
  if (error.code === "user_already_exists") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("user already registered");
}

export function isEmailSendRateLimited(error: SignUpErrorLike): boolean {
  if (!error) return false;
  if (error.code === "over_email_send_rate_limit") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    error.status === 429 &&
    (message.includes("email rate limit") ||
      message.includes("over_email_send_rate_limit"))
  );
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
    if (isEmailSendRateLimited(error)) {
      return { outcome: "error", message: SIGNUP_EMAIL_RATE_LIMIT_FAIL };
    }
    // Never forward raw Auth/DB text to the browser.
    return {
      outcome: "error",
      message: SIGNUP_GENERIC_FAIL,
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
