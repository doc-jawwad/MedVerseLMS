import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import {
  McqBankFoldersAdmin,
  type McqBankFolderRow,
} from "../mcq-bank-folders-admin";

export const metadata = { title: "Manage MCQ folders — MedVerse Admin" };

export default async function AdminMcqBankProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productKey: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase, profile } = await requireAdmin();
  const { productKey: rawKey } = await params;
  const productKey = decodeURIComponent(rawKey);
  const sp = await searchParams;

  return requireAdminClass({
    searchYear: sp.year,
    next: `/admin/mcq-bank/${encodeURIComponent(productKey)}`,
    children: async (year) => {
      const { data: subject } = await supabase
        .from("subjects")
        .select("id, name, product_key")
        .eq("year_id", year.id)
        .eq("product_key", productKey)
        .maybeSingle();

      if (!subject?.id) notFound();

      const { data: folderRows, error } = await supabase.rpc(
        "admin_list_mcq_bank_folders",
        { p_product_subject_id: subject.id }
      );
      if (error) {
        return (
          <p className="text-sm text-destructive">
            Could not load folders. Try again.
          </p>
        );
      }

      const folders: McqBankFolderRow[] = (folderRows ?? []).map(
        (row: {
          folder_id: string;
          name: string;
          sort_order: number;
          question_count: number | string;
          pdf_count?: number | string;
          subfolder_count?: number | string;
        }) => ({
          folder_id: row.folder_id,
          name: row.name,
          sort_order: Number(row.sort_order ?? 0),
          question_count: Number(row.question_count ?? 0),
          pdf_count: Number(row.pdf_count ?? 0),
          ...(row.subfolder_count != null
            ? { subfolder_count: Number(row.subfolder_count) }
            : {}),
        })
      );

      return (
        <McqBankFoldersAdmin
          yearId={year.id}
          productKey={productKey}
          productSubjectId={subject.id}
          subjectName={subject.name}
          folders={folders}
          isMainAdmin={Boolean(profile.is_main_admin)}
        />
      );
    },
  });
}
