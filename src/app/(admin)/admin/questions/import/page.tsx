import { requireAdmin } from "@/lib/auth/require-user";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import questions — MedVerse Admin" };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    folderId?: string;
    year?: string;
    subjectId?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const folderId = sp.folderId?.trim() || undefined;

  const [{ data: subjects }, { data: batches }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name, years(year_number)")
      .order("name"),
    supabase
      .from("import_batches")
      .select(
        "id, filename, total_rows, inserted, skipped_duplicates, errors, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const subjectItems = (subjects ?? []).map((s) => {
    const y = s.years as unknown as { year_number: number } | null;
    return { id: s.id, label: `Year ${y?.year_number} — ${s.name}` };
  });

  let folderLabel: string | undefined;
  let returnHref: string | undefined;
  const lockedSubjectId = sp.subjectId?.trim() || undefined;

  if (folderId) {
    const { data: folder } = await supabase
      .from("mcq_bank_folders")
      .select("id, name, year_id, academic_product_subject_id")
      .eq("id", folderId)
      .is("deleted_at", null)
      .maybeSingle();

    if (folder) {
      folderLabel = folder.name;
      const { data: product } = await supabase
        .from("subjects")
        .select("product_key")
        .eq("id", folder.academic_product_subject_id)
        .maybeSingle();
      if (product?.product_key) {
        returnHref = `/admin/mcq-bank/${encodeURIComponent(product.product_key)}/${folderId}?year=${folder.year_id}`;
      }
    }
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Import questions</h1>
      <ImportClient
        subjects={subjectItems}
        recentBatches={batches ?? []}
        mcqBankFolderId={folderId}
        folderLabel={folderLabel}
        lockedSubjectId={lockedSubjectId}
        returnHref={returnHref}
      />
    </div>
  );
}
