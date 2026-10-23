import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import {
  attemptUsageLabel,
  classifyCatalogTestStates,
  displayTestTitle,
  formatMcqCount,
  retakeHref,
  studentTestListLabel,
  studentTestsPageSection,
  summarizeAttemptsByTest,
  testPricingLabel,
  type StudentTestListState,
  type StudentTestsPageSection,
} from "@/lib/tests/student-test-state";
import { finalizeOwnExpiredAttempts } from "@/lib/tests/finalize-own-expired";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { SectionHeading } from "@/components/student/section-heading";
import { EmptyState } from "@/components/student/empty-state";
import { StudyMarkdown } from "@/components/study/study-markdown";
import { OpensCountdown } from "@/components/study/opens-countdown";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import {
  bindSsrTiming,
  ssrMarkPageFnEnd,
  ssrSpan,
  ssrSpanSync,
} from "@/lib/observability/ssr-timing-rsc";

export const metadata = { title: "Tests — MedVerse LMS" };

type AttemptRow = {
  id: string;
  test_id: string;
  state: string;
  expires_at: string | null;
  score: number | null;
  max_score: number | null;
  percentage: number | null;
  rank: number | null;
  submitted_at: string | null;
};

const SECTIONS: { key: StudentTestsPageSection; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "available", label: "Available" },
  { key: "in_progress", label: "In progress" },
  { key: "previous", label: "Previous" },
];

export default async function StudentTestsPage() {
  await bindSsrTiming("/tests");
  const { supabase, userId } = await requireStudent();
  await finalizeOwnExpiredAttempts(supabase);

  const [
    { data: tests },
    { data: attempts },
    { data: accessible },
    { data: subscriptions },
    { data: grants },
    { data: prepRows },
  ] = await Promise.all([
    ssrSpan("fetch.tests", () =>
      supabase
        .from("tests")
        .select(
          "id, title, status, opens_at, closes_at, duration_minutes, entitlement, syllabus, max_attempts, subjects(name), question_count"
        )
        .order("opens_at", { ascending: false })
    ),
    ssrSpan("fetch.test_attempts", () =>
      supabase
        .from("test_attempts")
        .select(
          "id, test_id, state, expires_at, score, max_score, percentage, rank, submitted_at"
        )
        .eq("student_id", userId)
        .neq("state", "invalidated")
    ),
    ssrSpan("fetch.accessible_test_ids", () =>
      supabase.rpc("accessible_test_ids")
    ),
    ssrSpan("fetch.subscriptions", () =>
      supabase
        .from("subscriptions")
        .select("starts_at, ends_at")
        .eq("student_id", userId)
    ),
    ssrSpan("fetch.access_grants", () =>
      supabase
        .from("access_grants")
        .select("test_id, created_at, revoked_at")
        .eq("student_id", userId)
        .eq("grant_type", "test")
    ),
    ssrSpan("fetch.accessible_test_prep", () =>
      supabase.rpc("accessible_test_prep")
    ),
  ]);

  const entitled = new Set(
    ((accessible ?? []) as { id: string }[]).map((row) => row.id)
  );

  const { rows } = ssrSpanSync("in_process.classify", () => {
    const { displayByTest: attemptByTest, countedByTest } =
      summarizeAttemptsByTest((attempts ?? []) as AttemptRow[]);

    // eslint-disable-next-line react-hooks/purity -- RSC renders once per request
    const nowMs = Date.now();

    const states = classifyCatalogTestStates({
      nowMs,
      tests: tests ?? [],
      attempts: attempts ?? [],
      accessibleIds: (accessible ?? []).map((row: { id: string }) => row.id),
      subscriptions: subscriptions ?? [],
      grants: grants ?? [],
    });

    const rows = (tests ?? []).map((t, i) => {
      const state: StudentTestListState = states[i]!;
      return {
        t,
        attempt: attemptByTest.get(t.id) ?? null,
        counted: countedByTest.get(t.id) ?? 0,
        state,
        section: studentTestsPageSection(state),
      };
    });

    return { rows };
  });

  const prepByTest = new Map(
    ((prepRows ?? []) as { test_id: string; body_text: string }[]).map((row) => [
      row.test_id,
      row.body_text,
    ])
  );

  ssrMarkPageFnEnd();

  return (
    <StudentPage>
      <PageHeader
        title="Tests"
        description="Upcoming, available, in-progress, and previous tests for your class. Locked tests keep their eligibility explanation."
      />

      {SECTIONS.map((sec) => {
        const items = rows.filter((r) => r.section === sec.key);
        if (items.length === 0) return null;
        return (
          <div key={sec.key} className="grid gap-3" data-testid={`tests-section-${sec.key}`}>
            <SectionHeading title={sec.label} />
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map(({ t, attempt, counted, state }) => {
                const s = t.subjects as unknown as { name: string } | null;
                const qc = t.question_count;
                const pricing = testPricingLabel(t.entitlement);
                const isEntitled = entitled.has(t.id);
                const maxAttempts = t.max_attempts ?? 1;
                const canStart =
                  state === "in_progress" ||
                  (state === "available" && isEntitled);
                const canRetake = state === "retake_available" && isEntitled;
                const showSubscriptionLock =
                  !isEntitled &&
                  state !== "in_progress" &&
                  (state === "locked" ||
                    state === "available" ||
                    state === "upcoming");
                return (
                  <Card
                    key={t.id}
                    className="surface-card border-border/80 shadow-none"
                    data-testid={`tests-card-${state}`}
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
                              state === "in_progress" ||
                              state === "available" ||
                              state === "retake_available"
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
                        {formatMcqCount(qc)} · {t.duration_minutes} minutes
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

                      {state === "upcoming" && t.opens_at && (
                        <OpensCountdown opensAt={t.opens_at} />
                      )}

                      {canStart && (
                        <Button asChild className="w-fit">
                          <Link href={`/tests/${t.id}/attempt`}>
                            {state === "in_progress"
                              ? "Resume test"
                              : "Start test"}
                          </Link>
                        </Button>
                      )}
                      {canRetake && (
                        <Button asChild className="w-fit">
                          <Link href={retakeHref(t.id, counted)}>
                            Retake test
                          </Link>
                        </Button>
                      )}
                      {attemptUsageLabel(state, counted, maxAttempts) && (
                        <p
                          className="text-muted-foreground"
                          data-testid="tests-attempt-count"
                        >
                          {attemptUsageLabel(state, counted, maxAttempts)}
                        </p>
                      )}
                      {showSubscriptionLock && <ResourceLockNotice />}

                      {(state === "result" || state === "retake_available") &&
                        attempt?.state === "submitted" && (
                          <div className="flex flex-wrap items-center gap-3">
                            <span>
                              {attempt.score}/{attempt.max_score} (
                              {attempt.percentage}%)
                            </span>
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/tests/${t.id}/result`}>
                                View result
                              </Link>
                            </Button>
                          </div>
                        )}
                      {state === "result" &&
                        attempt?.state !== "submitted" && (
                          <p className="text-muted-foreground">
                            This attempt has ended. Your result will appear
                            shortly.
                          </p>
                        )}
                      {state === "missed" && (
                        <p className="text-muted-foreground">
                          You were eligible during the window but did not start.
                          This is not recorded as a score of zero.
                        </p>
                      )}
                      {state === "not_eligible" && (
                        <p className="text-muted-foreground">
                          You were not eligible to sit this test during its
                          window. A later subscription does not change that.
                        </p>
                      )}
                      {state === "locked" && !showSubscriptionLock && (
                        <p className="text-muted-foreground">
                          This test is listed for your class but you cannot
                          start it with your current access.
                        </p>
                      )}
                      {typeof t.syllabus === "string" &&
                        t.syllabus.trim() &&
                        (state === "upcoming" ||
                          state === "available" ||
                          state === "locked") &&
                        isEntitled && (
                          <div
                            className="rounded-lg border bg-muted/40 p-3"
                            data-testid="test-syllabus-panel"
                          >
                            <p className="mb-1 text-xs font-semibold tracking-wide text-[var(--brand-teal-ink)] uppercase">
                              Syllabus
                            </p>
                            <p className="whitespace-pre-wrap text-sm text-[var(--student-ink)]">
                              {t.syllabus}
                            </p>
                          </div>
                        )}
                      {prepByTest.get(t.id) &&
                        (state === "upcoming" ||
                          state === "available" ||
                          state === "locked" ||
                          state === "in_progress" ||
                          state === "retake_available" ||
                          state === "result") &&
                        isEntitled && (
                          <div className="rounded-lg border bg-muted/40 p-3">
                            <p className="mb-1 text-xs font-semibold tracking-wide text-[var(--brand-teal-ink)] uppercase">
                              Preparation
                            </p>
                            <StudyMarkdown source={prepByTest.get(t.id)!} />
                          </div>
                        )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {rows.length === 0 && (
        <EmptyState
          title="No tests yet"
          description="When a test is scheduled for your class, it will appear here under Upcoming or Available."
        />
      )}
    </StudentPage>
  );
}
