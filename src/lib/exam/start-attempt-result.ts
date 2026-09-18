/** start_attempt: prior submitted raises; same-call lazy-finalize returns a flag. */

export function startAttemptMeansAlreadySubmitted(
  errorMessage: string | null | undefined,
  data: unknown
): boolean {
  if (errorMessage && errorMessage.includes("already_submitted")) return true;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return (data as { already_submitted?: unknown }).already_submitted === true;
}
