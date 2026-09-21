import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { OneLinerEditor } from "../one-liner-editor";

export const metadata = { title: "New One-liner — MedVerse Admin" };

export default async function NewOneLinerPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/one-liners/new",
    children: async (year) => {
      const { data: subjects } = await supabase
        .from("subjects")
        .select("id, name")
        .eq("year_id", year.id)
        .order("name");

      return (
        <div className="grid gap-4">
          <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
            New One-liner
          </h1>
          <OneLinerEditor
            yearId={year.id}
            subjects={subjects ?? []}
          />
        </div>
      );
    },
  });
}
