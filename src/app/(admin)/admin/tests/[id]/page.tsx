import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { getAdminPermissionSet } from "@/lib/admin/admin-nav";
import { loadCurriculumFilterCascade } from "@/lib/admin/curriculum-load";
import {
  importBatchYieldsEmptyPool,
  resolveMcqBankScope,
  stemSearchPattern,
} from "@/lib/tests/random-selection-scope";
import { TestConfigForm } from "../test-config-form";
import {
  TestPrepGuidelinesForm,
  TestStudentAccessForm,
} from "../test-prep-form";
import { TestDraftAudienceProvider } from "../test-draft-audience-context";
import { TestBuilderManualMcq } from "../test-builder-manual-mcq";
import { TestBuilderCsvImport } from "../test-builder-csv-import";
import { DraftTestDeleteButton } from "../draft-test-actions";
import { QuestionPoolMultiAdd } from "./question-pool-multi-add";
import {
  AddRandomButton,
  AudiencePicker,
  KillSwitchPanel,
  MoveQuestionButtons,
  PublishButton,
  QuestionFilterForm,
  QuestionMarksInput,
  RemoveQuestionButton,
  ReuseAsDraftButton,
  ReturnToDraftButton,
  VoidQuestionButton,
} from "./test-actions";
import {
  presentPublishChecklistItem,
  publishChecklistBlockReason,
  type ValidateTestCheck,
} from "@/lib/tests/publish-checklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Test — MedVerse Admin" };

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
    import_batch?: string;
    bank?: string;
    folder?: string;
    subfolder?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminPermissionSet();
  const canPublishTests = perms.has("publish_tests");
  const canDeleteDraft = canPublishTests;
  const { id } = await params;
  const filters = await searchParams;
  const poolPage = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const importBatchId = filters.import_batch?.trim() || null;

  const { data: test } = await supabase
    .from("tests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!test) notFound();

  const isDraft = test.status === "draft";

  // Years + subjects are needed for config/audience (small). Full
  // books/chapters/topics trees are NOT loaded here — draft filters use
  // cascade slices for the current URL state; inline MCQ loads children
  // on demand. Avoids duplicating loadCurriculum() across all years.
  const [
    { data: years },
    { data: subjects },
    { data: testQuestions },
    { data: audiences },
    checklistRes,
    filterCurriculum,
    prepRes,
    { data: productBankRows },
    { data: mcqFolderRows },
    { data: mcqSubfolderRows },
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
    isDraft
      ? loadCurriculumFilterCascade(supabase, {
          yearId: test.year_id,
          subjectId: filters.subject,
          bookId: filters.book,
          chapterId: filters.chapter,
        })
      : Promise.resolve({
          books: [] as { id: string; name: string; subject_id: string }[],
          chapters: [] as { id: string; name: string; book_id: string }[],
          topics: [] as { id: string; name: string; chapter_id: string }[],
        }),
    supabase.rpc("get_test_prep_guidelines", { p_test_id: id }),
    isDraft
      ? supabase
          .from("subjects")
          .select("id, name")
          .eq("year_id", test.year_id)
          .not("product_key", "is", null)
          .order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    isDraft
      ? supabase
          .from("mcq_bank_folders")
          .select("id, name, year_id, academic_product_subject_id")
          .eq("year_id", test.year_id)
          .is("deleted_at", null)
          .order("name")
      : Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            year_id: string;
            academic_product_subject_id: string;
          }[],
        }),
    isDraft
      ? supabase
          .from("mcq_bank_subfolders")
          .select("id, name, folder_id")
          .is("deleted_at", null)
          .order("name")
      : Promise.resolve({
          data: [] as { id: string; name: string; folder_id: string }[],
        }),
  ]);

  const checklist = (checklistRes.data ?? []) as ValidateTestCheck[];
  const allPass = checklist.length > 0 && checklist.every((c) => c.pass);
  const checklistBlockReason = publishChecklistBlockReason(checklist);
  const orderedQuestions = testQuestions ?? [];

  const productBanks = (productBankRows ?? []).filter(
    (s): s is { id: string; name: string } => Boolean(s?.id && s?.name)
  );
  const mcqFolders = (mcqFolderRows ?? []) as Array<{
    id: string;
    name: string;
    year_id: string;
    academic_product_subject_id: string;
  }>;
  const folderIdSet = new Set(mcqFolders.map((f) => f.id));
  const mcqSubfolders = (
    (mcqSubfolderRows ?? []) as Array<{
      id: string;
      name: string;
      folder_id: string;
    }>
  ).filter((s) => folderIdSet.has(s.folder_id));

  // question picker pool (draft only), paginated the same way as the
  // question-bank list page. Optional import_batch scopes the pool to that
  // CSV import set (import_rows.question_id) so the set is selectable as a batch.
  let pool: {
    id: string;
    difficulty: string;
    stem: string | null;
    subject: string | null;
  }[] = [];
  let poolCount = 0;
  let importedSet: {
    batchId: string;
    filename: string;
    questionIds: string[];
  } | null = null;
  const filter = {
    subject_id: filters.subject,
    book_id: filters.book,
    chapter_id: filters.chapter,
    topic_id: filters.topic,
    difficulty: filters.difficulty,
    q: filters.q,
    import_batch_id: importBatchId ?? undefined,
    mcq_bank_product_subject_id: filters.bank,
    mcq_bank_folder_id: filters.folder,
    mcq_bank_subfolder_id: filters.subfolder,
  };
  const mcqScope = resolveMcqBankScope({
    filter,
    testYearId: test.year_id,
    folders: mcqFolders,
    subfolders: mcqSubfolders,
  });
  if (isDraft) {
    if (importBatchId) {
      const [{ data: batchMeta }, { data: batchRows }] = await Promise.all([
        supabase
          .from("import_batches")
          .select("id, filename")
          .eq("id", importBatchId)
          .maybeSingle(),
        supabase
          .from("import_rows")
          .select("question_id")
          .eq("batch_id", importBatchId)
          .not("question_id", "is", null)
          .order("row_number"),
      ]);
      if (batchMeta) {
        const questionIds = [
          ...new Set(
            (batchRows ?? [])
              .map((r) => r.question_id as string | null)
              .filter((qid): qid is string => Boolean(qid))
          ),
        ];
        importedSet = {
          batchId: batchMeta.id as string,
          filename: (batchMeta.filename as string) ?? "",
          questionIds,
        };
      }
    }

    let q = supabase
      .from("questions")
      .select(
        "id, difficulty, subjects(name), question_versions!questions_current_version_fk(stem)",
        { count: "exact" }
      )
      .eq("status", "approved")
      .eq("year_id", test.year_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range((poolPage - 1) * POOL_PAGE_SIZE, poolPage * POOL_PAGE_SIZE - 1);
    if (importedSet && importedSet.questionIds.length > 0) {
      q = q.in("id", importedSet.questionIds);
    }
    if (filters.subject) q = q.eq("subject_id", filters.subject);
    if (filters.book) q = q.eq("book_id", filters.book);
    if (filters.chapter) q = q.eq("chapter_id", filters.chapter);
    if (filters.topic) q = q.eq("topic_id", filters.topic);
    if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
    const stemPattern = stemSearchPattern(filters.q);
    if (stemPattern) q = q.ilike("stem_normalized", stemPattern);
    // Exact MCQ Bank scope — never broaden when bank/folder/subfolder is set.
    const skipMcqPool =
      importBatchYieldsEmptyPool(
        Boolean(importBatchId),
        importedSet?.questionIds
      ) ||
      mcqScope.kind === "invalid" ||
      (mcqScope.kind === "bank_folders" && mcqScope.folderIds.length === 0);
    if (skipMcqPool) {
      poolCount = 0;
      pool = [];
    } else {
      if (mcqScope.kind === "subfolder") {
        q = q.eq("mcq_bank_subfolder_id", mcqScope.subfolderId);
      } else if (mcqScope.kind === "folder") {
        q = q.eq("mcq_bank_folder_id", mcqScope.folderId);
      } else if (mcqScope.kind === "bank_folders") {
        q = q.in("mcq_bank_folder_id", mcqScope.folderIds);
      }
      const { data, count } = await q;
      poolCount = count ?? 0;
      const inTest = new Set(orderedQuestions.map((t) => t.question_id));
      pool = (data ?? [])
        .filter((r) => !inTest.has(r.id))
        .map((r) => ({
          id: r.id,
          difficulty: r.difficulty,
          stem:
            (r.question_versions as unknown as { stem: string } | null)?.stem ??
            null,
          subject:
            (r.subjects as unknown as { name: string } | null)?.name ?? null,
        }));
    }
  }
  const poolTotalPages = Math.max(1, Math.ceil(poolCount / POOL_PAGE_SIZE));

  const yearSubjects = (subjects ?? []).filter((s) => s.year_id === test.year_id);
  const yearLabel =
    (years ?? []).find((y) => y.id === test.year_id)?.year_number != null
      ? `Year ${(years ?? []).find((y) => y.id === test.year_id)!.year_number}`
      : "this test year";

  // UX gates only — RPCs re-check opens_at / attempts / closes_at under lock.
  const opensAtMs = test.opens_at ? new Date(test.opens_at).getTime() : NaN;
  const closesAtMs = test.closes_at ? new Date(test.closes_at).getTime() : NaN;
  const nowMs = Date.now();
  const showReturnToDraft =
    canPublishTests &&
    test.status === "published" &&
    Number.isFinite(opensAtMs) &&
    opensAtMs > nowMs;
  const showReuseAsDraft =
    canPublishTests &&
    (test.status === "published" || test.status === "closed") &&
    Number.isFinite(closesAtMs) &&
    closesAtMs <= nowMs;

  const poolFilterLink = (patch: Record<string, string | undefined>) => {
    const merged = { ...filters, page: undefined, ...patch };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return qs ? `?${qs}` : `/admin/tests/${id}`;
  };

  return (
    <TestDraftAudienceProvider
      entitlement={test.entitlement ?? "free"}
      status={test.status}
    >
      <div className="grid min-w-0 max-w-full gap-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-2xl font-semibold">{test.title}</h1>
          <Badge>{test.status}</Badge>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/tests/${id}/preview`}>Preview as student</Link>
          </Button>
          {isDraft && canDeleteDraft && (
            <DraftTestDeleteButton
              testId={id}
              title={test.title}
              redirectToList
            />
          )}
          {test.status !== "draft" && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/tests/${id}/results`}>Results</Link>
            </Button>
          )}
          {showReturnToDraft && (
            <ReturnToDraftButton testId={id} canManage={canPublishTests} />
          )}
          {showReuseAsDraft && (
            <ReuseAsDraftButton testId={id} canManage={canPublishTests} />
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
          <CardHeader><CardTitle className="text-base">Year audience</CardTitle></CardHeader>
          <CardContent>
            <AudiencePicker
              testId={id}
              years={years ?? []}
              selected={(audiences ?? []).map((a) => a.year_id)}
              readOnly={!isDraft}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Student access</CardTitle></CardHeader>
          <CardContent>
            <TestStudentAccessForm
              testId={id}
              entitlement={test.entitlement ?? "free"}
              status={test.status}
              readOnly={!isDraft}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Preparation guidelines</CardTitle></CardHeader>
          <CardContent>
            <TestPrepGuidelinesForm
              testId={id}
              initial={typeof prepRes.data === "string" ? prepRes.data : ""}
              readOnly={!isDraft}
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
                  className={`flex min-w-0 flex-col gap-2 rounded-md border p-2 text-sm sm:flex-row sm:items-center sm:justify-between ${tq.voided ? "opacity-60" : ""}`}>
                  <div className="min-w-0 break-words">
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
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {isDraft ? (
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/admin/questions/${tq.question_id}?fromTest=${id}`}
                          data-testid={`edit-draft-question-${tq.question_id}`}
                        >
                          Edit question
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/admin/questions/${tq.question_id}`}
                          data-testid={`open-bank-question-${tq.question_id}`}
                        >
                          Open in bank
                        </Link>
                      </Button>
                    )}
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
            <CardContent className="grid min-w-0 max-w-full gap-4">
              <TestBuilderManualMcq
                testId={id}
                yearId={test.year_id}
                yearLabel={yearLabel}
                subjects={yearSubjects}
              />

              <TestBuilderCsvImport testId={id} subjects={yearSubjects} />

              <QuestionFilterForm
                subjects={yearSubjects}
                books={filterCurriculum.books}
                chapters={filterCurriculum.chapters}
                topics={filterCurriculum.topics}
                productBanks={productBanks}
                mcqFolders={mcqFolders}
                mcqSubfolders={mcqSubfolders}
                filter={{
                  subject_id: filters.subject,
                  book_id: filters.book,
                  chapter_id: filters.chapter,
                  topic_id: filters.topic,
                  difficulty: filters.difficulty,
                  q: filters.q,
                  mcq_bank_product_subject_id: filters.bank,
                  mcq_bank_folder_id: filters.folder,
                  mcq_bank_subfolder_id: filters.subfolder,
                }}
              />

              {/* poolCount is an upper bound (matches the filter before
                  excluding already-added questions) — only used as the
                  input's max hint; addRandomQuestions itself always excludes
                  existing questions server-side regardless of this value. */}
              <AddRandomButton testId={id} filter={filter} poolSize={poolCount} />

              {importedSet ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    Pool scoped to imported CSV set
                  </span>
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      href={poolFilterLink({ import_batch: undefined })}
                      data-testid="clear-import-batch-filter"
                    >
                      Show full pool
                    </Link>
                  </Button>
                </div>
              ) : null}

              <QuestionPoolMultiAdd
                testId={id}
                pool={pool}
                importedSet={importedSet}
                alreadyOnTestIds={orderedQuestions.map((t) => t.question_id)}
              />

              {poolTotalPages > 1 && (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">
                  {poolPage > 1 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={poolFilterLink({ page: poolPage > 2 ? String(poolPage - 1) : undefined })}>
                        ← Previous
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>← Previous</Button>
                  )}
                  <span className="min-w-0 break-words text-muted-foreground">
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
              {checklist.map((c, i) => {
                const presented = presentPublishChecklistItem(c);
                return (
                  <div
                    key={i}
                    className="grid gap-0.5 text-sm"
                    data-testid="publish-checklist-item"
                    data-pass={c.pass ? "true" : "false"}
                    data-check={c.check}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={
                          c.pass ? "text-green-600" : "text-destructive"
                        }
                      >
                        {c.pass ? "✓" : "✗"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={c.pass ? undefined : "font-medium"}>
                          {presented.title}
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            — {presented.detail}
                          </span>
                        </p>
                        {presented.hint ? (
                          <p
                            className="mt-0.5 text-xs text-destructive"
                            data-testid="publish-checklist-hint"
                          >
                            {presented.hint}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="mt-2">
                <PublishButton
                  testId={id}
                  allPass={allPass}
                  canPublishTests={canPublishTests}
                  checklistBlockReason={checklistBlockReason}
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </TestDraftAudienceProvider>
  );
}
