import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { yearDisplayName } from "@/lib/library/types";
import {
  ProfSessionAdmin,
  type ProfSessionDayRow,
} from "./prof-session-admin";

export const metadata = { title: "Prof. Session — MedVerse Admin" };

export default async function AdminProfSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/prof-session",
    children: async (year) => {
      const { data } = await supabase
        .from("prof_session_days")
        .select("id, name, sort_order, status")
        .eq("year_id", year.id)
        .is("deleted_at", null)
        .order("sort_order")
        .order("name");

      const days: ProfSessionDayRow[] = (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        sort_order: Number(row.sort_order ?? 0),
        status: row.status === "published" ? "published" : "draft",
      }));

      return (
        <ProfSessionAdmin
          yearId={year.id}
          yearLabel={yearDisplayName(year)}
          days={days}
        />
      );
    },
  });
}
