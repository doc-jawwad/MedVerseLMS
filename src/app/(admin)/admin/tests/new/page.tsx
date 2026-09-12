import { requireAdmin } from "@/lib/auth/require-user";
import { TestConfigForm } from "../test-config-form";

export const metadata = { title: "Create test — MedVerse Admin" };

export default async function NewTestPage() {
  const { supabase } = await requireAdmin();
  const [{ data: years }, { data: subjects }] = await Promise.all([
    supabase.from("years").select("id, year_number").order("year_number"),
    supabase.from("subjects").select("id, name, year_id").order("name"),
  ]);

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Create test</h1>
      <TestConfigForm years={years ?? []} subjects={subjects ?? []} />
    </div>
  );
}
