import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { OspeStationEditor } from "../ospe-station-editor";

export const metadata = { title: "New OSPE Station — MedVerse Admin" };

export default async function NewOspeStationPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/ospe-stations/new",
    children: async (year) => {
      const [{ data: years }, { data: subjects }] = await Promise.all([
        supabase
          .from("years")
          .select("id, year_number, name")
          .order("year_number"),
        supabase.from("subjects").select("id, name, year_id").order("name"),
      ]);
      return (
        <div className="grid gap-4">
          <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
            Add OSPE station
          </h1>
          <OspeStationEditor
            years={years ?? []}
            subjects={subjects ?? []}
            lockYear
            initial={{
              title: "",
              answer: "",
              year_id: year.id,
              subject_id: "",
              status: "draft",
              sort_order: 0,
            }}
          />
        </div>
      );
    },
  });
}
