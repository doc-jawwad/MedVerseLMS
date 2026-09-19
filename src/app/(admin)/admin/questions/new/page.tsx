import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { QuestionEditor } from "../question-editor";
import { loadCurriculum } from "../curriculum-data";

export const metadata = { title: "New question — MedVerse Admin" };

export default async function NewQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/questions/new",
    children: async (year) => {
      const curriculum = await loadCurriculum(supabase);
      return (
        <div className="grid gap-4">
          <h1 className="text-2xl font-semibold">New question</h1>
          <QuestionEditor
            curriculum={curriculum}
            initial={{ year_id: year.id }}
          />
        </div>
      );
    },
  });
}
