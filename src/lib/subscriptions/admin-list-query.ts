/** Calendar months for admin subscription filters (Pakistan Standard Time). */
const PKT_TZ = "Asia/Karachi";
export type AdminSubscriptionMonthParam = string | undefined | null;

export function parseYearMonth(
  value: AdminSubscriptionMonthParam
): { year: number; month: number } | null {
  if (!value || value === "all") return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Inclusive start / exclusive end of a calendar month in Asia/Karachi,
 * as UTC ISO timestamps for PostgREST `starts_at` filters.
 * Pakistan has no DST (fixed UTC+05:00).
 */
export function pktMonthUtcRange(
  year: number,
  month: number
): { startIso: string; endIso: string } {
  const start = new Date(Date.UTC(year, month - 1, 1, -5, 0, 0, 0));
  const end =
    month === 12
      ? new Date(Date.UTC(year + 1, 0, 1, -5, 0, 0, 0))
      : new Date(Date.UTC(year, month, 1, -5, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function formatYearMonthLabel(year: number, month: number): string {
  const stamp = new Date(Date.UTC(year, month - 1, 15, 0, 0, 0, 0));
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(stamp);
}

function pktYearMonthParts(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PKT_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/** Recent months (PKT) for the selector, newest first, plus any selected value. */
export function adminSubscriptionMonthOptions(
  now = new Date(),
  selected?: AdminSubscriptionMonthParam,
  count = 24
): string[] {
  const { year, month } = pktYearMonthParts(now);
  const seen = new Set<string>();
  const out: string[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i += 1) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  const extra = parseYearMonth(selected);
  if (extra) {
    const key = `${extra.year}-${String(extra.month).padStart(2, "0")}`;
    if (!seen.has(key)) out.push(key);
  }
  return out;
}

export function adminSubscriptionsHref(opts: {
  yearId: string;
  status?: string | null;
  q?: string | null;
  month?: AdminSubscriptionMonthParam;
}): string {
  const params = new URLSearchParams();
  params.set("year", opts.yearId);
  if (opts.status) params.set("status", opts.status);
  const term = opts.q?.trim();
  if (term) params.set("q", term);
  const month = parseYearMonth(opts.month);
  if (month) {
    params.set(
      "month",
      `${month.year}-${String(month.month).padStart(2, "0")}`
    );
  }
  return `/admin/subscriptions?${params.toString()}`;
}

export function serialNumber(indexInFilteredPage: number, pageOffset = 0): number {
  return pageOffset + indexInFilteredPage + 1;
}

/** Browse lists (no search) stay capped; search scopes by matched student ids instead. */
export const ADMIN_SUBSCRIPTION_BROWSE_LIMIT = 300;
export const ADMIN_SUBSCRIPTION_SEARCH_STUDENT_LIMIT = 100;
export const ADMIN_SUBSCRIPTION_SEARCH_ROW_LIMIT = 500;

export function normalizeAdminStudentSearchTerm(
  q: string | undefined | null
): string | undefined {
  const term = q?.trim().toLowerCase();
  return term || undefined;
}

/** Escape LIKE wildcards so user input is matched literally. */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * PostgREST `or` filter for student name/email contains-search.
 * Values are double-quoted so commas/parens in the term do not split the list.
 */
export function adminStudentNameEmailOrFilter(term: string): string {
  const pattern = `%${escapeIlikePattern(term)}%`;
  const quoted = `"${pattern.replace(/"/g, '\\"')}"`;
  return `full_name.ilike.${quoted},email.ilike.${quoted}`;
}

export type AdminSubscriptionStudentScope =
  | { kind: "browse"; limit: number }
  | { kind: "byIds"; studentIds: string[]; limit: number }
  | { kind: "empty" };

/**
 * Decide how subscription/enrollment queries should constrain students.
 * Search must resolve matching profile ids in the DB first — never filter only
 * the browse window after `.limit(browse)`.
 */
export function adminSubscriptionStudentScope(opts: {
  searchTerm: string | undefined;
  /** Profile ids from a name/email query; ignored when there is no search term. */
  matchedStudentIds?: string[] | null;
}): AdminSubscriptionStudentScope {
  if (!opts.searchTerm) {
    return { kind: "browse", limit: ADMIN_SUBSCRIPTION_BROWSE_LIMIT };
  }
  const ids = opts.matchedStudentIds ?? [];
  if (ids.length === 0) return { kind: "empty" };
  return {
    kind: "byIds",
    studentIds: ids,
    limit: ADMIN_SUBSCRIPTION_SEARCH_ROW_LIMIT,
  };
}

export function matchesAdminSubscriptionFilters(opts: {
  statusFilter: string | undefined;
  searchTerm: string | undefined;
  isLive: boolean;
  displayStatus: string;
  rowStatus: string;
  fullName: string | null | undefined;
  email: string | null | undefined;
  /**
   * When true, name/email were already applied via DB student-id scope —
   * only status filters run here.
   */
  searchAppliedInQuery?: boolean;
}): boolean {
  const status = opts.statusFilter ?? "";
  if (status === "active" && !opts.isLive) return false;
  if (status === "expired" && opts.displayStatus !== "expired") return false;
  if (status === "deactivated" && opts.rowStatus !== "deactivated") return false;
  if (opts.searchAppliedInQuery) return true;
  const term = opts.searchTerm?.toLowerCase().trim();
  if (!term) return true;
  return Boolean(
    opts.fullName?.toLowerCase().includes(term) ||
      opts.email?.toLowerCase().includes(term)
  );
}
