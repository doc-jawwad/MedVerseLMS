import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import {
  McqBankFolderQuestions,
  type FolderQuestionRow,
} from "../../mcq-bank-folder-questions";

export const metadata = { title: "MCQ Bank folder — MedVerse Admin" };

const PAGE_SIZE = 50;

export default async function AdminMcqBankFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ productKey: string; folderId: string }>;
  searchParams: Promise<{ year?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { productKey: rawKey, folderId } = await params;
  const productKey = decodeURIComponent(rawKey);
  const sp = await searchParams;
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);

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

      const { data: folder } = await supabase
        .from("mcq_bank_folders")
        .select("id, name, academic_product_subject_id, year_id")
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

      const { data: rows, error } = await supabase.rpc(
        "admin_list_folder_questions",
        {
          p_folder_id: folderId,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        }
      );

      if (error) {
        return (
          <p className="text-sm text-destructive">
            Could not load folder questions. Try again.
          </p>
        );
      }

      const list = (rows ?? []) as Array<{
        question_id: string;
        status: string;
        difficulty: string | null;
        stem: string | null;
        subject_name: string | null;
        topic_name: string | null;
        total_count: number | string;
      }>;

      const questions: FolderQuestionRow[] = list.map((r) => ({
        question_id: r.question_id,
        status: r.status,
        difficulty: r.difficulty,
        stem: r.stem,
        subject_name: r.subject_name,
        topic_name: r.topic_name,
      }));

      const totalCount =
        list.length > 0 ? Number(list[0]!.total_count ?? 0) : 0;

      return (
        <McqBankFolderQuestions
          yearId={year.id}
          productKey={productKey}
          folderId={folderId}
          folderName={folder.name}
          subjectName={subject.name}
          questions={questions}
          totalCount={totalCount}
          page={page}
          pageSize={PAGE_SIZE}
        />
      );
    },
  });
}
