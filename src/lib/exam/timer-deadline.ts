/**
 * Client exam timer helpers (8J-D). Server `expires_at` is authoritative;
 * the client deadline may move earlier only, never later.
 */

/** Merge server expires_at into the displayed deadline (earlier-only). */
export function applyServerExpiresAt(
  currentDeadlineMs: number,
  serverExpiresAtMs: number
): number {
  if (!Number.isFinite(serverExpiresAtMs)) return currentDeadlineMs;
  if (!Number.isFinite(currentDeadlineMs)) return serverExpiresAtMs;
  return Math.min(currentDeadlineMs, serverExpiresAtMs);
}

/** Remaining ms from server-skew-adjusted client clock. */
export function msRemainingFromServerClock(
  deadlineMs: number,
  serverNowMs: number,
  clientNowMs: number = Date.now()
): number {
  const skew = serverNowMs - clientNowMs;
  return deadlineMs - (clientNowMs + skew);
}

/** Earlier-only merge for ISO timestamps (returns prev when server is later). */
export function applyServerExpiresAtIso(
  currentIso: string | null | undefined,
  serverIso: string | null | undefined
): string | null {
  if (!serverIso) return currentIso ?? null;
  if (!currentIso) return serverIso;
  const serverMs = new Date(serverIso).getTime();
  const currentMs = new Date(currentIso).getTime();
  if (!Number.isFinite(serverMs)) return currentIso;
  if (!Number.isFinite(currentMs)) return serverIso;
  return serverMs < currentMs ? serverIso : currentIso;
}
