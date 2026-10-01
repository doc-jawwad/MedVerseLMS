import type { AdminYearOption } from "@/components/admin/class-selector";

export type AdminYearAssignmentRow = {
  admin_id: string;
  year_id: string;
  year_number: number;
  year_name: string;
};

/** Detect PostgREST/Postgres "function missing" shapes (fail-closed callers). */
export function isAdminYearAccessRpcMissing(
  error: { message?: string | null; code?: string | null } | null
): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  const code = (error?.code ?? "").toLowerCase();
  return (
    code === "pgrst202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883")
  );
}

/**
 * Fail-closed year-access decision for limited admins.
 * Missing/unavailable/malformed RPC results → deny (never allow).
 */
export function resolveAdminYearAccessDecision(input: {
  isMainAdmin: boolean;
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}): boolean {
  if (input.isMainAdmin) return true;
  if (input.error) return false;
  return input.data === true;
}

/** Map assignment rows onto known year options; empty on any assignment failure. */
export function resolveAdminYearsForCaller(input: {
  isMainAdmin: boolean;
  allYears: AdminYearOption[];
  assigned: AdminYearAssignmentRow[] | null;
  assignmentError: { message?: string | null; code?: string | null } | null;
}): AdminYearOption[] {
  if (input.isMainAdmin) return input.allYears;
  if (input.assignmentError) return [];
  const assigned = input.assigned ?? [];
  const byId = new Map(input.allYears.map((y) => [y.id, y]));
  return assigned
    .map((row) => byId.get(row.year_id))
    .filter((y): y is AdminYearOption => Boolean(y));
}
