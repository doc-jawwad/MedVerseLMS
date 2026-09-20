/**
 * Pick the most recently completed formal test for dashboard / analytics boards.
 * "Completed" = published (or closed) with closes_at in the past.
 * Does not invent ranking — caller fetches via test_leaderboard adapter.
 */

export type CompletedTestCandidate = {
  id: string;
  title: string;
  status: string;
  closes_at: string | null;
  opens_at?: string | null;
  entitlement?: string | null;
};

export type ResolvedCompletedTest = {
  id: string;
  title: string;
  closesAt: string;
};

const COMPLETED_STATUSES = new Set(["published", "closed"]);

/**
 * Among catalog-visible formal tests, return the one whose window closed
 * most recently (by closes_at desc). Returns null when none have closed.
 */
export function resolveLastCompletedTest(
  candidates: readonly CompletedTestCandidate[],
  nowMs: number
): ResolvedCompletedTest | null {
  let best: ResolvedCompletedTest | null = null;
  let bestClosesMs = Number.NEGATIVE_INFINITY;

  for (const t of candidates) {
    if (!COMPLETED_STATUSES.has(t.status)) continue;
    if (!t.closes_at) continue;
    const closesMs = new Date(t.closes_at).getTime();
    if (!Number.isFinite(closesMs) || closesMs > nowMs) continue;
    if (!t.id || !t.title) continue;
    if (closesMs > bestClosesMs) {
      bestClosesMs = closesMs;
      best = { id: t.id, title: t.title, closesAt: t.closes_at };
    }
  }

  return best;
}
