import { safeInternalPath } from "../http/safe-internal-path.ts";

/** Destination after a successful recovery OTP verify (before password update). */
export const PASSWORD_RECOVERY_PATH = "/reset-password";

/**
 * Password recovery must not run ensure_profile before the user sets a new
 * password. A failed ensure_profile previously redirected to
 * /login?reason=profile and dropped a valid recovery session on the Sign in page.
 */
export function isPasswordRecoveryOtpType(
  type: string | null | undefined
): boolean {
  return type === "recovery";
}

/** Safe post-verify path for recovery links (`next` query or default). */
export function passwordRecoveryNextPath(
  next: string | null | undefined
): string {
  return safeInternalPath(next, PASSWORD_RECOVERY_PATH);
}

/**
 * Public redirect_to for resetPasswordForEmail when Auth uses the default
 * ConfirmationURL (Cloud /auth/v1/verify → app). Custom recovery.html still
 * links to /auth/confirm?token_hash=…&type=recovery&next=/reset-password.
 */
export function passwordRecoveryRedirectTo(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${PASSWORD_RECOVERY_PATH}`;
}
