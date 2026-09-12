import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { ExamPlayer, type ExamQuestion } from "@/components/exam/exam-player";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Test preview — MedVerse Admin" };

export default async function TestPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;

  const { data: test } = await supabase
    .from("tests")
    .select("id, title, duration_minutes, status")
    .eq("id", id)
    .maybeSingle();
  if (!test) notFound();

  // Preview uses CURRENT versions in draft, frozen versions after publish.
  const { data: tqs } = await supabase
    .from("test_questions")
    .select(
      "position, question_version_id, questions(current_version_id)"
    )
    .eq("test_id", id)
    .order("position");

  const versionIds = (tqs ?? []).map(
    (t) =>
      t.question_version_id ??
      (t.questions as unknown as { current_version_id: string }).current_version_id
  );

  const { data: versions } = await supabase
    .from("question_versions")
    .select("id, stem, options")
    .in("id", versionIds.length > 0 ? versionIds : ["00000000-0000-0000-0000-000000000000"]);

  const questions: ExamQuestion[] = versionIds
    .map((vid) => versions?.find((v) => v.id === vid))
    .filter(Boolean)
    .map((v) => ({
      question_version_id: v!.id,
      stem: v!.stem,
      options: v!.options as { key: string; text: string }[],
    }));

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{test.title} — preview</h1>
          <p className="text-sm text-muted-foreground">
            Dry run: nothing is recorded, the timer is simulated.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/admin/tests/${id}`}>Back to test</Link>
        </Button>
      </div>
      <ExamPlayer
        mode="preview"
        title={test.title}
        durationMinutes={test.duration_minutes}
        questions={questions}
      />
    </div>
  );
}
