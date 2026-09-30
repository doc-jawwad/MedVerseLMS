import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import {
  McqBankClassifyClient,
  type FolderOption,
  type ProductSubjectOption,
  type SubfolderOption,
  type UnassignedQuestionRow,
} from "../mcq-bank-classify-client";

export const metadata = { title: "Classify MCQs — MedVerse Admin" };

const PAGE_SIZE = 50;

export default async function AdminMcqBankClassifyPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);

  return requireAdminClass({
    searchYear: sp.year,
    next: "/admin/mcq-bank/classify",
    children: async (year) => {
      const { data: subjectRows } = await supabase
        .from("subjects")
        .select("id, name, product_key, sort_order")
        .eq("year_id", year.id)
        .not("product_key", "is", null)
        .order("sort_order")
        .order("name");

      const subjects: ProductSubjectOption[] = (subjectRows ?? [])
        .filter((s) => typeof s.product_key === "string" && s.product_key)
        .map((s) => ({
          id: s.id as string,
          name: s.name as string,
          product_key: s.product_key as string,
        }));

      const subjectIds = subjects.map((s) => s.id);
      let folders: FolderOption[] = [];
      let subfolders: SubfolderOption[] = [];
      if (subjectIds.length > 0) {
        const { data: folderRows } = await supabase
          .from("mcq_bank_folders")
          .select("id, name, academic_product_subject_id, sort_order")
          .in("academic_product_subject_id", subjectIds)
          .is("deleted_at", null)
          .order("sort_order")
          .order("name");

        folders = (folderRows ?? []).map((f) => ({
          folder_id: f.id as string,
          name: f.name as string,
          product_subject_id: f.academic_product_subject_id as string,
        }));

        const folderIds = folders.map((f) => f.folder_id);
        if (folderIds.length > 0) {
          const lists = await Promise.all(
            folderIds.map(async (folderId) => {
              const { data } = await supabase.rpc(
                "admin_list_mcq_bank_subfolders",
                { p_folder_id: folderId }
              );
              return (
                (data ?? []) as Array<{
                  subfolder_id: string;
                  name: string;
                }>
              ).map((s) => ({
                subfolder_id: s.subfolder_id,
                name: s.name,
                folder_id: folderId,
              }));
            })
          );
          subfolders = lists.flat();
        }
      }

      const { data: rows, error } = await supabase.rpc(
        "admin_list_unassigned_questions",
        {
          p_year_id: year.id,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        }
      );

      if (error) {
        return (
          <p className="text-sm text-destructive">
            Could not load unassigned questions. Try again.
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

      const questions: UnassignedQuestionRow[] = list.map((r) => ({
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
        <McqBankClassifyClient
          yearId={year.id}
          subjects={subjects}
          folders={folders}
          subfolders={subfolders}
          questions={questions}
          totalCount={totalCount}
          page={page}
          pageSize={PAGE_SIZE}
        />
      );
    },
  });
}
