/**
 * Attempt-page live-subscription gate is UX only.
 * start_attempt remains authoritative for resume vs new start.
 */

export function attemptPageUsesLiveAccessGate(hasExistingAttempt: boolean): boolean {
  return !hasExistingAttempt;
}

/**
 * `?attempt=N` on the attempt URL is the counted-attempt number the student
 * intends to start (start_attempt p_attempt_no). Anything else is ignored.
 */
export function parseAttemptNo(
  raw: string | string[] | null | undefined
): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || !/^[1-9][0-9]{0,6}$/.test(v)) return null;
  return Number(v);
}

/**
 * Whether the UX live-access gate should be skipped. A live in_progress attempt
 * always resumes. Submitted history alone skips it only for a legacy link
 * (no attempt number) so start_attempt can answer already_submitted; an
 * explicit retake of a paid test still passes through the gate.
 */
export function attemptPageHasExistingAttempt(
  rows: readonly { state: string }[],
  attemptNo: number | null
): boolean {
  if (rows.some((r) => r.state === "in_progress")) return true;
  return attemptNo === null && rows.some((r) => r.state === "submitted");
}
