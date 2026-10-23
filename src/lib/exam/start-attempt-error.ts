/** Map start_attempt PostgREST errors without collapsing unrelated failures. */

export const START_ATTEMPT_ERROR_CODES = [
  // Prefer closed/stale attempt outcomes over device/session kick copy.
  "already_submitted",
  "attempt_limit_reached",
  "attempt_no_mismatch",
  "attempt_finalized",
  "attempt_expired",
  "test_window_closed",
  "test_access_denied",
  "account_blocked",
  "session_superseded",
  "attempt_locked_other_device",
] as const;

export type StartAttemptErrorCode = (typeof START_ATTEMPT_ERROR_CODES)[number];

/**
 * First matching exam-engine code wins. Closed/stale attempt codes are checked
 * before session_superseded / attempt_locked_other_device so a finished paper
 * is never shown as a second-device kick.
 */
export function matchStartAttemptError(
  message: string | null | undefined
): StartAttemptErrorCode | "unknown" {
  if (!message) return "unknown";
  for (const code of START_ATTEMPT_ERROR_CODES) {
    if (message.includes(code)) return code;
  }
  return "unknown";
}

export function isOtherDeviceLockMessage(message: string | null | undefined): boolean {
  return matchStartAttemptError(message) === "attempt_locked_other_device";
}

export function isSessionSupersededMessage(message: string | null | undefined): boolean {
  return matchStartAttemptError(message) === "session_superseded";
}
