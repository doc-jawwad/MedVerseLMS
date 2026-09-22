import Link from "next/link";
import { McqBankPage } from "@/components/library/mcq-bank-page";
import { MaterialLibraryPage } from "@/components/library/material-library-page";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import {
  PROF_SESSION_LABEL,
  PROF_SESSION_MCQ_BANK_SLUG,
  buildAcademicBreadcrumbs,
  dayHref,
  type AcademicProfSessionSubject,
  type AcademicTree,
  type AcademicTreeFolder,
  type TestDaySlotId,
} from "@/lib/academic-tree";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import {
  classifyCatalogTestStates,
  displayTestTitle,
  formatMcqCount,
  studentTestListLabel,
  testPricingLabel,
  type StudentTestListState,
} from "@/lib/tests/student-test-state";
import { finalizeOwnExpiredAttempts } from "@/lib/tests/finalize-own-expired";

/** Only rendered for subscribed students (page gate shows SectionLock for free). */
export async function ProfSessionSlotPage({
  tree,
  subject,
  day,
  slotId,
  slot,
}: {
  tree: AcademicTree;
  subject: AcademicProfSessionSubject;
  day: AcademicTreeFolder;
  slotId: TestDaySlotId;
  slot: AcademicTreeFolder;
}) {
  const breadcrumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: "MCQ Bank",
    categorySlug: PROF_SESSION_MCQ_BANK_SLUG,
    dayName: day.name,
    daySlug: day.slug,
    slotName: slot.name,
    slotSlug: slot.slug,
  });
  const backHref = dayHref(subject.product_key, day.slug);
  const subjectId = subject.subject_id.startsWith("product:")
    ? undefined
    : subject.subject_id;

  if (slotId === "guidelines" || slotId === "los") {
    return (
      <MaterialLibraryPage
        libraryType={slotId === "los" ? "los" : "guidelines"}
        mode="full"
        subjectId={subjectId}
        contentSurface="prof_session"
        profSessionDayId={day.id}
        daySlotKey={slotId}
        breadcrumbs={breadcrumbs}
        title={`${day.name} · ${slot.name}`}
        description={
          slotId === "los"
            ? "Learning outcomes for this Prof. Session day."
            : "Guidelines for this Prof. Session day."
        }
        backHref={backHref}
      />
    );
  }

  if (slotId === "one_liners") {
    return (
      <ProfSessionOneLinersSlot
        dayId={day.id}
        title={`${day.name} · ${slot.name}`}
        breadcrumbs={breadcrumbs}
        backHref={backHref}
      />
    );
  }

  if (slotId === "practice_mcqs") {
    return (
      <McqBankPage
        mode="full"
        subjectId={subjectId}
        profSessionDayId={day.id}
        breadcrumbs={breadcrumbs}
        title={`${day.name} · ${slot.name}`}
        description="Practice MCQs curated for this Prof. Session day."
        backHref={backHref}
      />
    );
  }

  if (slotId === "test_mcq") {
    return (
      <ProfSessionDayTestsSlot
        dayId={day.id}
        title={`${day.name} · Test MCQs`}
        breadcrumbs={breadcrumbs}
        backHref={backHref}
      />
    );
  }

  return null;
}

async function ProfSessionOneLinersSlot({
  dayId,
  title,
  breadcrumbs,
  backHref,
}: {
  dayId: string;
  title: string;
  breadcrumbs: ReturnType<typeof buildAcademicBreadcrumbs>;
  backHref: string;
}) {
  const { supabase } = await requireStudent();
  const { data } = await supabase
    .from("one_liners")
    .select("id, title, body")
    .eq("prof_session_day_id", dayId)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("sort_order")
    .order("title");

  const rows = (data ?? []) as { id: string; title: string; body: string }[];

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={breadcrumbs} />
      <PageHeader
        title={title}
        description="Day-scoped one-liners (not Pearl Points)."
        actions={
          <Link
            href={backHref}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to day
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No one-liners for this day"
          description="Published one-liners linked to this day will appear here."
        />
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-border/80 bg-card px-4 py-3"
            >
              <p className="font-medium text-[var(--student-ink)]">{row.title}</p>
              {row.body ? (
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                  {row.body}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </StudentPage>
  );
}

type AttemptRow = {
  id: string;
  test_id: string;
  state: string;
  expires_at: string | null;
  score: number | null;
  max_score: number | null;
  percentage: number | null;
};

async function ProfSessionDayTestsSlot({
  dayId,
  title,
  breadcrumbs,
  backHref,
}: {
  dayId: string;
  title: string;
  breadcrumbs: ReturnType<typeof buildAcademicBreadcrumbs>;
  backHref: string;
}) {
  const { supabase, userId } = await requireStudent();
  await finalizeOwnExpiredAttempts(supabase);

  const [
    { data: tests },
    { data: attempts },
    { data: accessible },
    { data: subscriptions },
    { data: grants },
  ] = await Promise.all([
    supabase
      .from("tests")
      .select(
        "id, title, status, opens_at, closes_at, duration_minutes, entitlement, subjects(name), question_count"
      )
      .eq("prof_session_day_id", dayId)
      .order("opens_at", { ascending: false }),
    supabase
      .from("test_attempts")
      .select(
        "id, test_id, state, expires_at, score, max_score, percentage"
      )
      .eq("student_id", userId)
      .neq("state", "invalidated"),
    supabase.rpc("accessible_test_ids"),
    supabase
      .from("subscriptions")
      .select("starts_at, ends_at")
      .eq("student_id", userId),
    supabase
      .from("access_grants")
      .select("test_id, created_at, revoked_at")
      .eq("student_id", userId)
      .eq("grant_type", "test"),
  ]);

  const attemptByTest = new Map<string, AttemptRow>();
  for (const a of (attempts ?? []) as AttemptRow[]) {
    const prev = attemptByTest.get(a.test_id);
    if (!prev || a.state === "submitted") attemptByTest.set(a.test_id, a);
  }

  const nowMs = Date.now();
  const states = classifyCatalogTestStates({
    nowMs,
    tests: tests ?? [],
    attempts: attempts ?? [],
    accessibleIds: ((accessible ?? []) as { id: string }[]).map((row) => row.id),
    subscriptions: subscriptions ?? [],
    grants: grants ?? [],
  });

  const rows = (
    (tests ?? []) as unknown as {
      id: string;
      title: string;
      status: string;
      opens_at: string | null;
      closes_at: string | null;
      duration_minutes: number;
      entitlement: string;
      subjects: { name: string } | null;
      question_count: number | null;
    }[]
  ).map((t, i) => {
    const state: StudentTestListState = states[i]!;
    return {
      t,
      attempt: attemptByTest.get(t.id) ?? null,
      state,
    };
  });

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={breadcrumbs} />
      <PageHeader
        title={title}
        description={`${PROF_SESSION_LABEL} formal Test MCQs for this day use the standard exam engine.`}
        actions={
          <Link
            href={backHref}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to day
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No Test MCQs for this day"
          description="When your academy links a published test to this day, it appears here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map(({ t, attempt, state }) => {
            const s = t.subjects as unknown as { name: string } | null;
            const pricing = testPricingLabel(t.entitlement);
            const canStart =
              state === "in_progress" ||
              (state === "available" &&
                ((accessible ?? []) as { id: string }[]).some(
                  (row) => row.id === t.id
                ));
            const showLock =
              state === "locked" ||
              (state === "available" &&
                !((accessible ?? []) as { id: string }[]).some(
                  (row) => row.id === t.id
                ));
            return (
              <Card
                key={t.id}
                className="surface-card border-border/80 shadow-none"
              >
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base text-[var(--student-ink)]">
                      {displayTestTitle(t.title, pricing)}
                    </CardTitle>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <Badge variant="outline">{pricing}</Badge>
                      <Badge
                        variant={
                          state === "in_progress"
                            ? "default"
                            : state === "result"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {studentTestListLabel(state)}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>
                    {s?.name && `${s.name} · `}
                    {formatMcqCount(t.question_count ?? 0)} ·{" "}
                    {t.duration_minutes} minutes
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <p className="text-muted-foreground">
                    {t.opens_at && (
                      <>
                        Opens: {formatDateTime(t.opens_at)}
                        <br />
                      </>
                    )}
                    {t.closes_at && (
                      <>Closes: {formatDateTime(t.closes_at)}</>
                    )}
                  </p>

                  {canStart && (
                    <Button asChild className="w-fit">
                      <Link href={`/tests/${t.id}/attempt`}>
                        {state === "in_progress" ? "Resume test" : "Start test"}
                      </Link>
                    </Button>
                  )}
                  {state === "result" && attempt?.state === "submitted" && (
                    <div className="flex flex-wrap items-center gap-3">
                      <span>
                        {attempt.score}/{attempt.max_score} (
                        {attempt.percentage}%)
                      </span>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/tests/${t.id}/result`}>View result</Link>
                      </Button>
                    </div>
                  )}
                  {state === "upcoming" && (
                    <p className="text-muted-foreground">
                      This test is not open yet.
                    </p>
                  )}
                  {showLock && <ResourceLockNotice />}
                  {state === "missed" && (
                    <p className="text-muted-foreground">
                      You were eligible during the window but did not start.
                    </p>
                  )}
                  {state === "not_eligible" && (
                    <p className="text-muted-foreground">
                      You were not eligible to sit this test during its window.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </StudentPage>
  );
}
