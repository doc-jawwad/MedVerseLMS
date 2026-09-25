import { requireAdmin } from "@/lib/auth/require-user";
import { CareerCounselingSeriesAdmin } from "./career-counseling-series-admin";

export const metadata = { title: "Career Counseling Series — MedVerse Admin" };

export default async function AdminCareerCounselingSeriesPage() {
  const { supabase } = await requireAdmin();

  const [{ data: folders }, { data: materials }] = await Promise.all([
    supabase
      .from("material_folders")
      .select(
        "id, name, description, year_id, subject_id, parent_id, sort_order, entitlement, library_type"
      )
      .eq("library_type", "career_counseling_series")
      .is("deleted_at", null)
      .is("parent_id", null)
      .order("sort_order")
      .order("name"),
    supabase
      .from("materials")
      .select(
        "id, folder_id, title, description, file_type, kind, status"
      )
      .is("deleted_at", null)
      .order("sort_order")
      .order("title"),
  ]);

  const list = folders ?? [];
  const folderIds = new Set(list.map((f) => f.id));
  const listMaterials = (materials ?? []).filter((m) =>
    folderIds.has(m.folder_id)
  );

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          Universal · Study
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Career Counseling Series
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          One academy-wide hub for every class — not class-scoped, not part of
          Other Services. Flat folders with protected PDFs. Soft-delete sends
          folders and files to the Bin.
        </p>
      </div>
      <CareerCounselingSeriesAdmin
        folders={list}
        materials={listMaterials}
      />
    </div>
  );
}
