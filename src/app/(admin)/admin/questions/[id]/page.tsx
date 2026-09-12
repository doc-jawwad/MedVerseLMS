import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { QuestionEditor } from "../question-editor";
import { loadCurriculum } from "../curriculum-data";
import { StatusControls } from "./status-controls";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Edit question — MedVerse Admin" };

export default async function EditQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;

  const { data: q } = await supabase
    .from("questions")
    .select(
      "id, status, difficulty, tags, used_in_test, year_id, subject_id, book_id, chapter_id, topic_id, current_version_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (!q) notFound();

  const [{ data: current }, { data: history }] = await Promise.all([
    supabase
      .from("question_versions")
      .select("stem, options, correct_key, explanation, reference, version_no")
      .eq("id", q.current_version_id)
      .single(),
    supabase
      .from("question_versions")
      .select("id, version_no, created_at")
      .eq("question_id", id)
      .order("version_no", { ascending: false }),
  ]);

  const curriculum = await loadCurriculum(supabase);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Edit question</h1>
        <Badge variant="outline">v{current?.version_no}</Badge>
        {q.used_in_test && <Badge variant="secondary">used in test</Badge>}
        <StatusControls questionId={q.id} status={q.status} />
      </div>

      <QuestionEditor
        curriculum={curriculum}
        initial={{
          questionId: q.id,
          stem: current?.stem,
          options: current?.options as { key: string; text: string }[],
          correct_key: current?.correct_key?.trim(),
          explanation: current?.explanation,
          reference: current?.reference,
          difficulty: q.difficulty,
          tags: q.tags,
          status: q.status,
          year_id: q.year_id,
          subject_id: q.subject_id,
          book_id: q.book_id,
          chapter_id: q.chapter_id,
          topic_id: q.topic_id,
        }}
      />

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Version history</h2>
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {(history ?? []).map((v) => (
            <li key={v.id}>
              v{v.version_no} — {formatDateTime(v.created_at)}
              {v.id === q.current_version_id && " (current)"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
