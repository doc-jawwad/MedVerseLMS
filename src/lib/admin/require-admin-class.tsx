import "server-only";

import { requireAdmin } from "@/lib/auth/require-user";
import { resolveAdminYearId } from "@/lib/admin/selected-class";
import { loadAdminYearsForCaller } from "@/lib/admin/year-assignments";
import { AdminClassPicker } from "@/components/admin/class-picker";
import type { AdminYearOption } from "@/components/admin/class-selector";
import type { ReactNode } from "react";

export async function loadAdminYears(): Promise<AdminYearOption[]> {
  return loadAdminYearsForCaller();
}

export async function requireAdminClass(input: {
  searchYear?: string | null;
  next: string;
  children: (year: AdminYearOption) => ReactNode | Promise<ReactNode>;
}): Promise<ReactNode> {
  await requireAdmin();
  const years = await loadAdminYears();
  const yearId = await resolveAdminYearId(input.searchYear);
  const year = years.find((y) => y.id === yearId) ?? null;
  if (!year) {
    return <AdminClassPicker years={years} next={input.next} />;
  }
  return await input.children(year);
}
