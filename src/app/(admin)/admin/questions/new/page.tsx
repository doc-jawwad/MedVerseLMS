import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { QuestionEditor } from "../question-editor";
import { loadCurriculum } from "../curriculum-data";

export const metadata = { title: "New question — MedVerse Admin" };

export default async function NewQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; folderId?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const folderId = params.folderId?.trim() || undefined;

  return requireAdminClass({
    searchYear: params.year,
    next: folderId
      ? `/admin/questions/new?folderId=${folderId}`
      : "/admin/questions/new",
    children: async (year) => {
      const curriculum = await loadCurriculum(supabase);

      let folderLabel: string | null = null;
      if (folderId) {
        const { data: folder } = await supabase
          .from("mcq_bank_folders")
          .select("id, name, year_id")
          .eq("id", folderId)
          .is("deleted_at", null)
          .maybeSingle();
        if (folder && folder.year_id === year.id) {
          folderLabel = folder.name as string;
        }
      }

      return (
        <div className="grid gap-4">
          <div>
            <h1 className="text-2xl font-semibold">New question</h1>
            {folderLabel ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Will be placed in Academic MCQ Bank folder: {folderLabel}
              </p>
            ) : null}
          </div>
          <QuestionEditor
            curriculum={curriculum}
            initial={{
              year_id: year.id,
              mcq_bank_folder_id:
                folderLabel && folderId ? folderId : undefined,
            }}
          />
        </div>
      );
    },
  });
}
