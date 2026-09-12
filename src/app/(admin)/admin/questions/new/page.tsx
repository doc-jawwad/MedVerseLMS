import { requireAdmin } from "@/lib/auth/require-user";
import { QuestionEditor } from "../question-editor";
import { loadCurriculum } from "../curriculum-data";

export const metadata = { title: "New question — MedVerse Admin" };

export default async function NewQuestionPage() {
  const { supabase } = await requireAdmin();
  const curriculum = await loadCurriculum(supabase);

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">New question</h1>
      <QuestionEditor curriculum={curriculum} />
    </div>
  );
}
