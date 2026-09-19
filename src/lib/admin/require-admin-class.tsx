import "server-only";

import { requireAdmin } from "@/lib/auth/require-user";
import { resolveAdminYearId } from "@/lib/admin/selected-class";
import { AdminClassPicker } from "@/components/admin/class-picker";
import type { AdminYearOption } from "@/components/admin/class-selector";
import type { ReactNode } from "react";

export async function loadAdminYears(): Promise<AdminYearOption[]> {
  const { supabase } = await requireAdmin();
  const { data } = await supabase
    .from("years")
    .select("id, year_number, name")
    .order("year_number");
  return (data ?? []) as AdminYearOption[];
}

export async function requireAdminClass(input: {
  searchYear?: string | null;
  next: string;
  children: (year: AdminYearOption) => ReactNode | Promise<ReactNode>;
}): Promise<ReactNode> {
  const years = await loadAdminYears();
  const yearId = await resolveAdminYearId(input.searchYear);
  const year = years.find((y) => y.id === yearId) ?? null;
  if (!year) {
    return <AdminClassPicker years={years} next={input.next} />;
  }
  return await input.children(year);
}
