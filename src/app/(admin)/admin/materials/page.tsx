import { requireAdmin } from "@/lib/auth/require-user";
import { MaterialsAdmin } from "./materials-admin";

export const metadata = { title: "Materials — MedVerse Admin" };

export default async function AdminMaterialsPage() {
  const { supabase } = await requireAdmin();

  const [{ data: years }, { data: subjects }, { data: folders }, { data: materials }] =
    await Promise.all([
      supabase.from("years").select("id, year_number").order("year_number"),
      supabase.from("subjects").select("id, name, year_id").order("name"),
      supabase
        .from("material_folders")
        .select("id, name, year_id, subject_id")
        .order("sort_order")
        .order("name"),
      supabase
        .from("materials")
        .select("id, folder_id, title, description, file_type, drive_url")
        .order("sort_order")
        .order("title"),
    ]);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Study Materials</h1>
      <MaterialsAdmin
        years={years ?? []}
        subjects={subjects ?? []}
        folders={folders ?? []}
        materials={materials ?? []}
      />
    </div>
  );
}
