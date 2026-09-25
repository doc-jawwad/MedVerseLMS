import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { requireAdminAnyPermission } from "@/lib/admin/require-admin-permission";
import { yearDisplayName } from "@/lib/library/types";
import {
  ProfSessionAdmin,
  type ProfSessionDayRow,
  type ProfSessionSubjectOption,
} from "./prof-session-admin";

export const metadata = { title: "Prof. Session — MedVerse Admin" };

export default async function AdminProfSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; subject?: string }>;
}) {
  const gate = await requireAdminAnyPermission(
    ["manage_materials"],
    "Prof. Session"
  );
  if (gate.denied) return gate.denied;
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/prof-session",
    children: async (year) => {
      const { data: subjectRows } = await supabase
        .from("subjects")
        .select("id, name, product_key, sort_order")
        .eq("year_id", year.id)
        .not("product_key", "is", null)
        .order("sort_order")
        .order("name");

      const subjects: ProfSessionSubjectOption[] = (subjectRows ?? [])
        .filter((s) => typeof s.product_key === "string" && s.product_key)
        .map((s) => ({
          id: s.id as string,
          name: s.name as string,
          product_key: s.product_key as string,
        }));

      const selectedSubjectId =
        params.subject && subjects.some((s) => s.id === params.subject)
          ? params.subject
          : subjects[0]?.id ?? null;

      let days: ProfSessionDayRow[] = [];
      if (selectedSubjectId) {
        const { data } = await supabase
          .from("prof_session_days")
          .select("id, name, sort_order, status, subject_id")
          .eq("subject_id", selectedSubjectId)
          .is("deleted_at", null)
          .order("sort_order")
          .order("name");

        days = (data ?? []).map((row) => ({
          id: row.id as string,
          name: row.name as string,
          sort_order: Number(row.sort_order ?? 0),
          status: row.status === "published" ? "published" : "draft",
          subject_id: row.subject_id as string,
        }));
      }

      const selected = subjects.find((s) => s.id === selectedSubjectId) ?? null;

      return (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">Subjects:</span>
            {subjects.map((s) => {
              const href = `/admin/prof-session?year=${year.id}&subject=${s.id}`;
              const active = s.id === selectedSubjectId;
              return (
                <Link
                  key={s.id}
                  href={href}
                  className={
                    active
                      ? "font-medium text-[var(--brand-teal-ink)] underline-offset-4 underline"
                      : "text-muted-foreground underline-offset-4 hover:underline"
                  }
                >
                  {s.name}
                </Link>
              );
            })}
            {subjects.length === 0 ? (
              <span className="text-muted-foreground">
                No product Blocks for this class.
              </span>
            ) : null}
          </div>
          <ProfSessionAdmin
            yearId={year.id}
            yearLabel={yearDisplayName(year)}
            subjects={subjects}
            selectedSubject={selected}
            days={days}
          />
        </div>
      );
    },
  });
}
