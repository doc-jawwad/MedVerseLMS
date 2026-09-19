import { requireAdmin } from "@/lib/auth/require-user";
import { PearlEditor } from "../pearl-editor";

export const metadata = { title: "New Pearl Point — MedVerse Admin" };

export default async function NewPearlPage() {
  const { supabase } = await requireAdmin();
  const [{ data: years }, { data: subjects }, { data: chapters }, { data: topics }] = await Promise.all([
    supabase.from("years").select("id, year_number, name").order("year_number"),
    supabase.from("subjects").select("id, name, year_id").order("name"),
    supabase.from("chapters").select("id, name, subject_id").order("sort_order").order("name"),
    supabase.from("topics").select("id, name, chapter_id").order("sort_order").order("name"),
  ]);
  return (
    <div className="grid gap-4">
      <h1 className="font-heading text-2xl font-semibold text-[#072855]">Add Pearl Point</h1>
      <PearlEditor
        years={years ?? []}
        subjects={subjects ?? []}
        chapters={chapters ?? []}
        topics={topics ?? []}
      />
    </div>
  );
}
