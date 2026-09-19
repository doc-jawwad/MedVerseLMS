/**
 * Attempt-page live-subscription gate is UX only.
 * start_attempt remains authoritative for resume vs new start.
 */

export function attemptPageUsesLiveAccessGate(hasExistingAttempt: boolean): boolean {
  return !hasExistingAttempt;
}
