/**
 * Derive the dashboard "upcoming" test slice from a single catalog fetch.
 *
 * Matches the pre-v2 PostgREST query:
 *   status = published AND closes_at > now
 *   ORDER BY opens_at ASC (Postgres NULLS FIRST)
 *   LIMIT 20
 *
 * Callers may still re-sort with sortByOpensAtAsc for display (nulls last).
 */

export type DashboardUpcomingSource = {
  status: string;
  closes_at: string | null;
  opens_at: string | null;
};

export const DASHBOARD_UPCOMING_LIMIT = 20;

/** Postgres ASC default: NULLS FIRST. */
function compareOpensAtAscNullsFirst(
  a: string | null,
  b: string | null
): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return -1;
  if (bNull) return 1;
  return Date.parse(a!) - Date.parse(b!);
}

export function deriveDashboardUpcomingFromCatalog<
  T extends DashboardUpcomingSource,
>(catalog: readonly T[], nowMs: number, limit = DASHBOARD_UPCOMING_LIMIT): T[] {
  const filtered = catalog.filter((t) => {
    if (t.status !== "published") return false;
    if (t.closes_at == null || t.closes_at === "") return false;
    const closesMs = Date.parse(t.closes_at);
    return Number.isFinite(closesMs) && closesMs > nowMs;
  });

  filtered.sort((a, b) =>
    compareOpensAtAscNullsFirst(a.opens_at, b.opens_at)
  );

  return filtered.slice(0, Math.max(0, limit));
}

/**
 * Pair rows with their classified state, keep only incoming ones, THEN cap.
 * Capping before the state filter lets already-finished (result) tests that are
 * still inside their window consume the limit and push open tests off the list.
 */
export function pickIncomingWithState<T, S>(
  rows: readonly T[],
  states: readonly S[],
  isIncoming: (state: S) => boolean,
  limit = DASHBOARD_UPCOMING_LIMIT
): { t: T; state: S }[] {
  const out: { t: T; state: S }[] = [];
  for (let i = 0; i < rows.length && out.length < limit; i++) {
    if (isIncoming(states[i]!)) out.push({ t: rows[i]!, state: states[i]! });
  }
  return out;
}
