export const DIRECTORY_PAGE_SIZE = 50;
const MAX_PAGE = 10000;
const ACCOUNT_FILTERS = new Set(["", "active", "blocked", "restricted", "suspended", "deactivated", "revoked"]);

export function normalizeDirectoryParams(input: {
  q?: string | string[];
  account?: string | string[];
  page?: string | string[];
}) {
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 254) : "";
  const account = typeof input.account === "string" && ACCOUNT_FILTERS.has(input.account) ? input.account : "";
  const page = typeof input.page === "string" && /^\d{1,5}$/.test(input.page)
    ? Math.max(1, Math.min(MAX_PAGE, Number(input.page)))
    : 1;
  return { q, account, page, offset: (page - 1) * DIRECTORY_PAGE_SIZE };
}

export function directoryNamePattern(q: string): string {
  return "%" + q.replace(/[\\%_*]/g, "\\$&") + "%";
}

export function directoryHref(q: string, account: string, page: number): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (account) p.set("account", account);
  if (page > 1) p.set("page", String(page));
  const query = p.toString();
  return query ? "/admin/students?" + query : "/admin/students";
}
