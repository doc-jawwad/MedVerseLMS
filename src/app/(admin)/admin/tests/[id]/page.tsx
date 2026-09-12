import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { TestConfigForm } from "../test-config-form";
import {
  AddQuestionButton,
  AddRandomButton,
  AudiencePicker,
  KillSwitchPanel,
  PublishButton,
  QuestionFilterForm,
  RemoveQuestionButton,
  VoidQuestionButton,
} from "./test-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Test — MedVerse Admin" };

type Check = { check: string; pass: boolean; detail: string };

export default async function TestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    subject?: string;
    book?: string;
    chapter?: string;
    difficulty?: string;
    q?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const filters = await searchParams;

  const { data: test } = await supabase
    .from("tests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!test) notFound();

  const isDraft = test.status === "draft";

  const [
    { data: years },
    { data: subjects },
    { data: testQuestions },
    { data: audiences },
    checklistRes,
  ] = await Promise.all([
    supabase.from("years").select("id, year_number").order("year_number"),
    supabase.from("subjects").select("id, name, year_id").order("name"),
    supabase
      .from("test_questions")
      .select(
        "id, question_id, position, voided, void_policy, questions(difficulty, status, subjects(name), question_versions!questions_current_version_fk(stem))"
      )
      .eq("test_id", id)
      .order("position"),
    supabase.from("test_audiences").select("year_id").eq("test_id", id),
    isDraft ? supabase.rpc("validate_test", { p_test_id: id }) : Promise.resolve({ data: null }),
  ]);

  const checklist = (checklistRes.data ?? []) as Check[];
  const allPass = checklist.length > 0 && checklist.every((c) => c.pass);

  // question picker pool (draft only)
  let pool: {
    id: string;
    difficulty: string;
    stem: string | null;
    subject: string | null;
  }[] = [];
  const filter = {
    subject_id: filters.subject,
    book_id: filters.book,
    chapter_id: filters.chapter,
    difficulty: filters.difficulty,
  };
  if (isDraft) {
    let q = supabase
      .from("questions")
      .select(
        "id, difficulty, subjects(name), question_versions!questions_current_version_fk(stem)"
      )
      .eq("status", "approved")
      .eq("year_id", test.year_id)
      .limit(50);
    if (filters.subject) q = q.eq("subject_id", filters.subject);
    if (filters.book) q = q.eq("book_id", filters.book);
    if (filters.chapter) q = q.eq("chapter_id", filters.chapter);
    if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
    if (filters.q?.trim())
      q = q.ilike("stem_normalized", `%${filters.q.trim().toLowerCase()}%`);
    const { data } = await q;
    const inTest = new Set((testQuestions ?? []).map((t) => t.question_id));
    pool = (data ?? [])
      .filter((r) => !inTest.has(r.id))
      .map((r) => ({
        id: r.id,
        difficulty: r.difficulty,
        stem:
          (r.question_versions as unknown as { stem: string } | null)?.stem ?? null,
        subject: (r.subjects as unknown as { name: string } | null)?.name ?? null,
      }));
  }

  const yearSubjects = (subjects ?? []).filter((s) => s.year_id === test.year_id);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{test.title}</h1>
        <Badge>{test.status}</Badge>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/tests/${id}/preview`}>Preview as student</Link>
        </Button>
        {test.status !== "draft" && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/tests/${id}/results`}>Results</Link>
          </Button>
        )}
        {(test.status === "published" || test.status === "closed") && (
          <KillSwitchPanel testId={id} status={test.status} />
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
        <CardContent>
          <TestConfigForm
            years={years ?? []}
            subjects={subjects ?? []}
            testId={id}
            initial={test}
            readOnly={!isDraft}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Audience</CardTitle></CardHeader>
        <CardContent>
          <AudiencePicker
            testId={id}
            years={years ?? []}
            selected={(audiences ?? []).map((a) => a.year_id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Questions ({(testQuestions ?? []).length})
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(testQuestions ?? []).map((tq) => {
            const qq = tq.questions as unknown as {
              difficulty: string;
              status: string;
              subjects: { name: string } | null;
              question_versions: { stem: string } | null;
            } | null;
            return (
              <div key={tq.id}
                className={`flex items-center justify-between gap-2 rounded-md border p-2 text-sm ${tq.voided ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <span className="mr-2 text-muted-foreground">#{tq.position}</span>
                  <span className="font-medium">{qq?.question_versions?.stem}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {qq?.subjects?.name} · {qq?.difficulty}
                    {qq?.status !== "approved" && (
                      <span className="text-destructive"> · {qq?.status}</span>
                    )}
                    {tq.voided && ` · voided (${tq.void_policy})`}
                  </span>
                </div>
                {isDraft ? (
                  <RemoveQuestionButton testId={id} questionId={tq.question_id} />
                ) : test.status === "published" || test.status === "closed" ? (
                  <VoidQuestionButton testId={id} questionId={tq.question_id} voided={tq.voided} />
                ) : null}
              </div>
            );
          })}
          {(testQuestions ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No questions added yet.</p>
          )}
        </CardContent>
      </Card>

      {isDraft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add questions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <QuestionFilterForm
              subjects={yearSubjects}
              filter={{ subject_id: filters.subject, difficulty: filters.difficulty, q: filters.q }}
            />

            <AddRandomButton testId={id} filter={filter} poolSize={pool.length} />

            <div className="grid gap-1">
              {pool.map((p) => (
                <div key={p.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div className="min-w-0 truncate">
                    {p.stem}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.subject} · {p.difficulty}
                    </span>
                  </div>
                  <AddQuestionButton testId={id} questionId={p.id} />
                </div>
              ))}
              {pool.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No more approved questions match this filter.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isDraft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pre-publication checklist</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={c.pass ? "text-green-600" : "text-destructive"}>
                  {c.pass ? "✓" : "✗"}
                </span>
                <span>{c.check}</span>
                <span className="text-muted-foreground">— {c.detail}</span>
              </div>
            ))}
            <div className="mt-2">
              <PublishButton testId={id} allPass={allPass} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
