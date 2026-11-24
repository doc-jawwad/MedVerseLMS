import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { yearDisplayName } from "@/lib/library/types";
import { OspeBulkEditor } from "./ospe-bulk-editor";

export const metadata = { title: "Bulk OSPE drafts — MedVerse Admin" };

export default async function BulkOspePage({ searchParams }: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/ospe-stations/bulk",
    children: async (year) => {
      const { data: permitted, error: permissionError } = await supabase.rpc("has_permission", { p_code: "manage_materials" });
      if (permissionError || permitted !== true) return <p role="alert">You cannot manage OSPE stations.</p>;
      const { data: subjects, error } = await supabase.from("subjects").select("id, name").eq("year_id", year.id).order("name");
      if (error) return <p role="alert">Could not load subjects. Refresh and try again.</p>;
      return <div className="grid gap-4">
        <h1 className="font-heading text-2xl font-semibold">Bulk OSPE drafts — {yearDisplayName(year)}</h1>
        <OspeBulkEditor key={year.id} yearId={year.id} subjects={subjects ?? []} />
      </div>;
    },
  });
}
