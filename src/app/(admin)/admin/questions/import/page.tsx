import { requireAdmin } from "@/lib/auth/require-user";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import questions — MedVerse Admin" };

export default async function ImportPage() {
  const { supabase } = await requireAdmin();

  const [{ data: subjects }, { data: batches }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name, years(year_number)")
      .order("name"),
    supabase
      .from("import_batches")
      .select("id, filename, total_rows, inserted, skipped_duplicates, errors, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const subjectItems = (subjects ?? []).map((s) => {
    const y = s.years as unknown as { year_number: number } | null;
    return { id: s.id, label: `Year ${y?.year_number} — ${s.name}` };
  });

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Import questions</h1>
      <ImportClient subjects={subjectItems} recentBatches={batches ?? []} />
    </div>
  );
}
