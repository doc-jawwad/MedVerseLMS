import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { loadMcqMoveDestinations } from "@/lib/admin/load-mcq-move-destinations";
import {
  McqBankSubfolderQuestions,
  type SubfolderQuestionRow,
} from "../../../mcq-bank-subfolder-questions";

export const metadata = { title: "MCQ Bank subfolder — MedVerse Admin" };

const PAGE_SIZE = 50;

export default async function AdminMcqBankSubfolderPage({
  params,
  searchParams,
}: {
  params: Promise<{
    productKey: string;
    folderId: string;
    subfolderId: string;
  }>;
  searchParams: Promise<{ year?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { productKey: rawKey, folderId, subfolderId } = await params;
  const productKey = decodeURIComponent(rawKey);
  const sp = await searchParams;
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);

  return requireAdminClass({
    searchYear: sp.year,
    next: `/admin/mcq-bank/${encodeURIComponent(productKey)}/${folderId}/${subfolderId}`,
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

      const [{ data: subfolderList }, { data: rows, error }, moveDestinations] =
        await Promise.all([
          supabase.rpc("admin_list_mcq_bank_subfolders", {
            p_folder_id: folderId,
          }),
          supabase.rpc("admin_list_subfolder_questions", {
            p_subfolder_id: subfolderId,
            p_limit: PAGE_SIZE,
            p_offset: page * PAGE_SIZE,
          }),
          loadMcqMoveDestinations(supabase, subject.id),
        ]);

      const siblings = (
        (subfolderList ?? []) as Array<{
          subfolder_id: string;
          name: string;
        }>
      ).map((s) => ({
        subfolder_id: s.subfolder_id,
        name: s.name,
      }));

      const current = siblings.find((s) => s.subfolder_id === subfolderId);
      if (!current) notFound();

      if (error) {
        return (
          <p className="text-sm text-destructive">
            Could not load subfolder questions. Try again.
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

      const questions: SubfolderQuestionRow[] = list.map((r) => ({
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
        <McqBankSubfolderQuestions
          yearId={year.id}
          productKey={productKey}
          folderId={folderId}
          folderName={folder.name}
          subfolderId={subfolderId}
          subfolderName={current.name}
          subjectName={subject.name}
          questions={questions}
          moveDestinations={moveDestinations}
          totalCount={totalCount}
          page={page}
          pageSize={PAGE_SIZE}
        />
      );
    },
  });
}
