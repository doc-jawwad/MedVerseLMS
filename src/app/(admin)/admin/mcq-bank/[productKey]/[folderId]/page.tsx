import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { loadMcqMoveDestinations } from "@/lib/admin/load-mcq-move-destinations";
import {
  McqBankFolderQuestions,
  type FolderQuestionRow,
} from "../../mcq-bank-folder-questions";
import {
  McqBankSubfoldersAdmin,
  type FolderMaterialRow,
  type McqBankSubfolderRow,
} from "../../mcq-bank-subfolders-admin";

export const metadata = { title: "MCQ Bank folder — MedVerse Admin" };

const PAGE_SIZE = 50;

export default async function AdminMcqBankFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ productKey: string; folderId: string }>;
  searchParams: Promise<{ year?: string; page?: string }>;
}) {
  const { supabase, profile } = await requireAdmin();
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

      const [
        { data: subfolderRows, error },
        materialsRes,
        questionsRes,
        moveDestinations,
      ] = await Promise.all([
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
        supabase.rpc("admin_list_folder_questions", {
          p_folder_id: folderId,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        }),
        loadMcqMoveDestinations(supabase, subject.id),
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

      const qList = (questionsRes.data ?? []) as Array<{
        question_id: string;
        status: string;
        difficulty: string | null;
        stem: string | null;
        subject_name: string | null;
        topic_name: string | null;
        total_count: number | string;
      }>;

      const questions: FolderQuestionRow[] = qList.map((r) => ({
        question_id: r.question_id,
        status: r.status,
        difficulty: r.difficulty,
        stem: r.stem,
        subject_name: r.subject_name,
        topic_name: r.topic_name,
      }));

      const totalCount =
        qList.length > 0 ? Number(qList[0]!.total_count ?? 0) : 0;

      return (
        <div className="grid gap-10">
          <McqBankSubfoldersAdmin
            yearId={year.id}
            productKey={productKey}
            folderId={folderId}
            folderName={folder.name}
            subjectName={subject.name}
            materialFolderId={folder.material_folder_id}
            materials={materials}
            subfolders={subfolders}
            isMainAdmin={Boolean(profile.is_main_admin)}
          />
          {questionsRes.error ? (
            <p className="text-sm text-destructive">
              Could not load folder questions. Try again.
            </p>
          ) : (
            <McqBankFolderQuestions
              yearId={year.id}
              productKey={productKey}
              folderId={folderId}
              questions={questions}
              moveDestinations={moveDestinations}
              totalCount={totalCount}
              page={page}
              pageSize={PAGE_SIZE}
            />
          )}
        </div>
      );
    },
  });
}
