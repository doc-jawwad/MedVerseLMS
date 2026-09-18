/**
 * Layer-1 portal session companion (docs/permissions.md).
 * Kick predicate matches the previous Realtime handler: only a *replaced*
 * active_session_id evicts. Clearing to null is not treated as a kick here
 * (register_session / first paint). Exam exemption is applied by the caller.
 * Polling interval is UX, not the security boundary.
 */
export const SESSION_WATCH_POLL_MS = 15_000;

export function shouldKickForReplacedSession(args: {
  mySessionId: string | null | undefined;
  activeSessionId: string | null | undefined;
}): boolean {
  const mine = args.mySessionId ?? null;
  const active = args.activeSessionId ?? null;
  return Boolean(active && mine && active !== mine);
}
