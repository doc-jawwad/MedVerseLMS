import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import {
  McqBankSubfoldersAdmin,
  type FolderMaterialRow,
  type McqBankSubfolderRow,
} from "../../mcq-bank-subfolders-admin";

export const metadata = { title: "MCQ Bank folder — MedVerse Admin" };

export default async function AdminMcqBankFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ productKey: string; folderId: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { productKey: rawKey, folderId } = await params;
  const productKey = decodeURIComponent(rawKey);
  const sp = await searchParams;

  return requireAdminClass({
    searchYear: sp.year,
    next: `/admin/mcq-bank/${encodeURIComponent(productKey)}/${folderId}`,
    children: async (year) => {
      const { data: subject } = await supabase
        .from("subjects")
        .select("id, name, product_key")
        .eq("year_id", year.id)
        .eq("product_key", productKey)
        .maybeSingle();

      if (!subject?.id) notFound();

      let { data: folder } = await supabase
        .from("mcq_bank_folders")
        .select("id, name, academic_product_subject_id, year_id, material_folder_id")
        .eq("id", folderId)
        .is("deleted_at", null)
        .maybeSingle();

      if (
        !folder ||
        folder.academic_product_subject_id !== subject.id ||
        folder.year_id !== year.id
      ) {
        notFound();
      }

      if (!folder.material_folder_id) {
        await supabase.rpc("ensure_mcq_bank_material_folder", {
          p_mcq_folder_id: folderId,
        });
        const refreshed = await supabase
          .from("mcq_bank_folders")
          .select(
            "id, name, academic_product_subject_id, year_id, material_folder_id"
          )
          .eq("id", folderId)
          .is("deleted_at", null)
          .maybeSingle();
        folder = refreshed.data ?? folder;
      }

      const [{ data: subfolderRows, error }, materialsRes] = await Promise.all([
        supabase.rpc("admin_list_mcq_bank_subfolders", {
          p_folder_id: folderId,
        }),
        folder.material_folder_id
          ? supabase
              .from("materials")
              .select("id, title, description, kind, status")
              .eq("folder_id", folder.material_folder_id)
              .is("deleted_at", null)
              .order("sort_order")
              .order("title")
          : Promise.resolve({ data: [] as FolderMaterialRow[], error: null }),
      ]);

      if (error) {
        return (
          <p className="text-sm text-destructive">
            Could not load subfolders. Try again.
          </p>
        );
      }

      const subfolders: McqBankSubfolderRow[] = (
        (subfolderRows ?? []) as Array<{
          subfolder_id: string;
          name: string;
          sort_order: number | string;
          question_count: number | string;
        }>
      ).map((r) => ({
        subfolder_id: r.subfolder_id,
        name: r.name,
        sort_order: Number(r.sort_order ?? 0),
        question_count: Number(r.question_count ?? 0),
      }));

      const materials: FolderMaterialRow[] = (materialsRes.data ?? []).map(
        (m) => ({
          id: m.id,
          title: m.title,
          description: m.description ?? "",
          kind: m.kind,
          status: m.status,
        })
      );

      return (
        <McqBankSubfoldersAdmin
          yearId={year.id}
          productKey={productKey}
          folderId={folderId}
          folderName={folder.name}
          subjectName={subject.name}
          materialFolderId={folder.material_folder_id}
          materials={materials}
          subfolders={subfolders}
        />
      );
    },
  });
}
