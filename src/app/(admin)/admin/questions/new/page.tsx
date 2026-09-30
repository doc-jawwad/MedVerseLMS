import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { QuestionEditor } from "../question-editor";
import { loadCurriculum } from "../curriculum-data";

export const metadata = { title: "New question — MedVerse Admin" };

export default async function NewQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    folderId?: string;
    subfolderId?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const subfolderId = params.subfolderId?.trim() || undefined;
  const folderId = params.folderId?.trim() || undefined;

  return requireAdminClass({
    searchYear: params.year,
    next: subfolderId
      ? `/admin/questions/new?subfolderId=${subfolderId}`
      : folderId
        ? `/admin/questions/new?folderId=${folderId}`
        : "/admin/questions/new",
    children: async (year) => {
      const curriculum = await loadCurriculum(supabase);

      let placementLabel: string | null = null;
      let placementSubfolderId: string | undefined;

      if (subfolderId) {
        const { data: subfolder } = await supabase
          .from("mcq_bank_subfolders")
          .select("id, name, folder_id")
          .eq("id", subfolderId)
          .is("deleted_at", null)
          .maybeSingle();
        if (subfolder) {
          const { data: folder } = await supabase
            .from("mcq_bank_folders")
            .select("id, name, year_id")
            .eq("id", subfolder.folder_id)
            .is("deleted_at", null)
            .maybeSingle();
          if (folder && folder.year_id === year.id) {
            placementLabel = `${folder.name} / ${subfolder.name}`;
            placementSubfolderId = subfolder.id;
          }
        }
      }

      return (
        <div className="grid gap-4">
          <div>
            <h1 className="text-2xl font-semibold">New question</h1>
            {placementLabel ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Will be placed in Academic MCQ Bank subfolder: {placementLabel}
              </p>
            ) : null}
          </div>
          <QuestionEditor
            curriculum={curriculum}
            initial={{
              year_id: year.id,
              mcq_bank_subfolder_id: placementSubfolderId,
            }}
          />
        </div>
      );
    },
  });
}
