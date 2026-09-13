import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { loadCurriculum } from "../../questions/curriculum-data";
import { TestConfigForm } from "../test-config-form";
import {
  AddQuestionButton,
  AddRandomButton,
  AudiencePicker,
  KillSwitchPanel,
  MoveQuestionButtons,
  PublishButton,
  QuestionFilterForm,
  QuestionMarksInput,
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

const POOL_PAGE_SIZE = 50;

export default async function TestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    subject?: string;
    book?: string;
    chapter?: string;
    topic?: string;
    difficulty?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const filters = await searchParams;
  const poolPage = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);

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
    curriculum,
  ] = await Promise.all([
    supabase.from("years").select("id, year_number").order("year_number"),
    supabase.from("subjects").select("id, name, year_id").order("name"),
    supabase
      .from("test_questions")
      .select(
        "id, question_id, position, marks, voided, void_policy, questions(difficulty, status, subjects(name), question_versions!questions_current_version_fk(stem))"
      )
      .eq("test_id", id)
      .order("position"),
    supabase.from("test_audiences").select("year_id").eq("test_id", id),
    isDraft ? supabase.rpc("validate_test", { p_test_id: id }) : Promise.resolve({ data: null }),
    loadCurriculum(supabase),
  ]);

  const checklist = (checklistRes.data ?? []) as Check[];
  const allPass = checklist.length > 0 && checklist.every((c) => c.pass);
  const orderedQuestions = testQuestions ?? [];

  // question picker pool (draft only), paginated the same way as the
  // question-bank list page.
  let pool: {
    id: string;
    difficulty: string;
    stem: string | null;
    subject: string | null;
  }[] = [];
  let poolCount = 0;
  const filter = {
    subject_id: filters.subject,
    book_id: filters.book,
    chapter_id: filters.chapter,
    topic_id: filters.topic,
    difficulty: filters.difficulty,
  };
  if (isDraft) {
    let q = supabase
      .from("questions")
      .select(
        "id, difficulty, subjects(name), question_versions!questions_current_version_fk(stem)",
        { count: "exact" }
      )
      .eq("status", "approved")
      .eq("year_id", test.year_id)
      .order("created_at", { ascending: false })
      .range((poolPage - 1) * POOL_PAGE_SIZE, poolPage * POOL_PAGE_SIZE - 1);
    if (filters.subject) q = q.eq("subject_id", filters.subject);
    if (filters.book) q = q.eq("book_id", filters.book);
    if (filters.chapter) q = q.eq("chapter_id", filters.chapter);
    if (filters.topic) q = q.eq("topic_id", filters.topic);
    if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
    if (filters.q?.trim())
      q = q.ilike("stem_normalized", `%${filters.q.trim().toLowerCase()}%`);
    const { data, count } = await q;
    poolCount = count ?? 0;
    const inTest = new Set(orderedQuestions.map((t) => t.question_id));
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
  const poolTotalPages = Math.max(1, Math.ceil(poolCount / POOL_PAGE_SIZE));

  const yearSubjects = (subjects ?? []).filter((s) => s.year_id === test.year_id);

  const poolFilterLink = (patch: Record<string, string | undefined>) => {
    const merged = { ...filters, page: undefined, ...patch };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return qs ? `?${qs}` : `/admin/tests/${id}`;
  };

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
            Questions ({orderedQuestions.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {orderedQuestions.map((tq, idx) => {
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
                <div className="flex items-center gap-2">
                  {isDraft && (
                    <>
                      <QuestionMarksInput
                        testId={id}
                        questionId={tq.question_id}
                        marks={tq.marks}
                        defaultMarks={test.marks_per_question}
                      />
                      <MoveQuestionButtons
                        testId={id}
                        questionId={tq.question_id}
                        isFirst={idx === 0}
                        isLast={idx === orderedQuestions.length - 1}
                      />
                      <RemoveQuestionButton testId={id} questionId={tq.question_id} />
                    </>
                  )}
                  {!isDraft && (test.status === "published" || test.status === "closed") && (
                    <VoidQuestionButton testId={id} questionId={tq.question_id} voided={tq.voided} />
                  )}
                </div>
              </div>
            );
          })}
          {orderedQuestions.length === 0 && (
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
              books={curriculum.books}
              chapters={curriculum.chapters}
              topics={curriculum.topics}
              filter={{
                subject_id: filters.subject,
                book_id: filters.book,
                chapter_id: filters.chapter,
                topic_id: filters.topic,
                difficulty: filters.difficulty,
                q: filters.q,
              }}
            />

            {/* poolCount is an upper bound (matches the filter before
                excluding already-added questions) — only used as the
                input's max hint; addRandomQuestions itself always excludes
                existing questions server-side regardless of this value. */}
            <AddRandomButton testId={id} filter={filter} poolSize={poolCount} />

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

            {poolTotalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                {poolPage > 1 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={poolFilterLink({ page: poolPage > 2 ? String(poolPage - 1) : undefined })}>
                      ← Previous
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>← Previous</Button>
                )}
                <span className="text-muted-foreground">
                  Page {poolPage} of {poolTotalPages} ({poolCount} approved questions match)
                </span>
                {poolPage < poolTotalPages ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={poolFilterLink({ page: String(poolPage + 1) })}>Next →</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>Next →</Button>
                )}
              </div>
            )}
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
