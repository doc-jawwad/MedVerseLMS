import type { AdminStudent360Section } from "@/lib/admin/student-360/types";

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Read every row through PostgREST's max-rows cap by paging with range().
 * Any page error, or exceeding maxPages, reports ok=false so callers mark the
 * section unavailable instead of presenting a truncated/empty set as complete.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PageResult<T>,
  opts: { pageSize?: number; maxPages?: number } = {}
): Promise<{ ok: boolean; data: T[] }> {
  const pageSize = opts.pageSize ?? 1000;
  const maxPages = opts.maxPages ?? 100;
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await fetchPage(
      page * pageSize,
      page * pageSize + pageSize - 1
    );
    if (error || !data) return { ok: false, data: [] };
    rows.push(...data);
    if (data.length < pageSize) return { ok: true, data: rows };
  }
  return { ok: false, data: [] };
}

/**
 * Sections whose backing read failed. The failure detail is deliberately not
 * kept: error text can echo identifiers and must not reach the UI.
 */
export function unavailableSections(
  visible: readonly AdminStudent360Section[],
  failed: Partial<Record<AdminStudent360Section, boolean>>
): AdminStudent360Section[] {
  return visible.filter((s) => failed[s]);
}
