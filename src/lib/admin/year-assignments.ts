import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminYearOption } from "@/components/admin/class-selector";
import { requireAdmin } from "@/lib/auth/require-user";

export type AdminYearAssignmentRow = {
  admin_id: string;
  year_id: string;
  year_number: number;
  year_name: string;
};

function rpcMissing(error: { message?: string | null } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883")
  );
}

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
  if (error && rpcMissing(error)) {
    // Compat: spine not deployed — show all years (DB RPCs still authorize).
    return years;
  }
  if (error) {
    return [];
  }

  const assigned = (data ?? []) as AdminYearAssignmentRow[];
  const byId = new Map(years.map((y) => [y.id, y]));
  return assigned
    .map((row) => byId.get(row.year_id))
    .filter((y): y is AdminYearOption => Boolean(y));
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
  if (error && rpcMissing(error)) {
    // Compat until spine: allow cookie selection; mutations stay RPC-gated.
    return true;
  }
  if (error) return false;
  return Boolean(data);
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
