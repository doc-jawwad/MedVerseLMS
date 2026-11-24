export const OSPE_PAGE_SIZE = 50;
export const OSPE_MAX_PAGE = 10_000;

export function ospePageWindow(value: unknown) {
  const parsed = typeof value === "string" && /^\d{1,5}$/.test(value)
    ? Number(value) : 1;
  const page = Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= OSPE_MAX_PAGE
    ? parsed : 1;
  const start = (page - 1) * OSPE_PAGE_SIZE;
  // PostgREST range end is inclusive; one extra row signals the next page.
  return { page, start, end: start + OSPE_PAGE_SIZE };
}

export function ospePageRows<T>(rows: readonly T[]) {
  return { rows: rows.slice(0, OSPE_PAGE_SIZE), hasNext: rows.length > OSPE_PAGE_SIZE };
}

export function ospePageHref(filters: {
  year: string;
  q?: string;
  status?: string;
}, page: number) {
  const params = new URLSearchParams({ year: filters.year });
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.status === "draft" || filters.status === "published") {
    params.set("status", filters.status);
  }
  if (page > 1) params.set("page", String(page));
  return "/admin/ospe-stations?" + params.toString();
}
