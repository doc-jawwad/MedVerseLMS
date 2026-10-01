import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminYearOption } from "@/components/admin/class-selector";
import { requireAdmin } from "@/lib/auth/require-user";
import {
  type AdminYearAssignmentRow,
  resolveAdminYearAccessDecision,
  resolveAdminYearsForCaller,
} from "@/lib/admin/year-access-decision";

export type { AdminYearAssignmentRow };
export {
  isAdminYearAccessRpcMissing,
  resolveAdminYearAccessDecision,
  resolveAdminYearsForCaller,
} from "@/lib/admin/year-access-decision";

/** Main Admin → all years. Limited Admin → assigned years only (Data Spine). */
export async function loadAdminYearsForCaller(
  supabase?: SupabaseClient
): Promise<AdminYearOption[]> {
  const gate = await requireAdmin();
  const sb = supabase ?? gate.supabase;

  const { data: allYears } = await sb
    .from("years")
    .select("id, year_number, name")
    .order("year_number");
  const years = (allYears ?? []) as AdminYearOption[];

  if (gate.profile.is_main_admin) {
    return years;
  }

  const { data, error } = await sb.rpc("list_admin_year_assignments");
  return resolveAdminYearsForCaller({
    isMainAdmin: false,
    allYears: years,
    assigned: (data ?? null) as AdminYearAssignmentRow[] | null,
    assignmentError: error,
  });
}

export async function adminCanAccessYear(
  yearId: string,
  supabase?: SupabaseClient
): Promise<boolean> {
  const gate = await requireAdmin();
  const sb = supabase ?? gate.supabase;
  if (gate.profile.is_main_admin) return true;

  const { data, error } = await sb.rpc("admin_can_access_year", {
    p_year_id: yearId,
  });
  return resolveAdminYearAccessDecision({
    isMainAdmin: false,
    data,
    error,
  });
}

export async function listAdminYearAssignments(
  adminId?: string | null,
  supabase?: SupabaseClient
): Promise<
  | { ok: true; data: AdminYearAssignmentRow[] }
  | { ok: false; error: string }
> {
  const gate = await requireAdmin();
  const sb = supabase ?? gate.supabase;
  const { data, error } = await sb.rpc("list_admin_year_assignments", {
    p_admin_id: adminId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as AdminYearAssignmentRow[] };
}

export async function setAdminYearAssignments(
  adminId: string,
  yearIds: string[],
  supabase?: SupabaseClient
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  const sb = supabase ?? gate.supabase;
  const { error } = await sb.rpc("set_admin_year_assignments", {
    p_admin_id: adminId,
    p_year_ids: yearIds,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
