import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import {
  classifyCatalogTestStates,
  isHistoryTestsPageState,
  studentTestListLabel,
  testPricingLabel,
  type StudentTestListState,
} from "@/lib/tests/student-test-state";
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
  score: number | null;
  max_score: number | null;
  percentage: number | null;
  rank: number | null;
  submitted_at: string | null;
};

export default async function StudentTestsPage() {
  await bindSsrTiming("/tests");
  const { supabase, userId } = await requireStudent();

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
          "id, title, status, opens_at, closes_at, duration_minutes, entitlement, subjects(name), question_count"
        )
        .order("opens_at", { ascending: false })
    ),
    ssrSpan("fetch.test_attempts", () =>
      supabase
        .from("test_attempts")
        .select(
          "id, test_id, state, score, max_score, percentage, rank, submitted_at"
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

  const { rows, sections } = ssrSpanSync("in_process.classify", () => {
    const attemptByTest = new Map<string, AttemptRow>();
    for (const a of (attempts ?? []) as AttemptRow[]) {
      // Prefer submitted over in_progress if both somehow present (shouldn't).
      const prev = attemptByTest.get(a.test_id);
      if (!prev || a.state === "submitted") attemptByTest.set(a.test_id, a);
    }

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
        state,
      };
    });

    return {
      rows: rows.filter((r) => isHistoryTestsPageState(r.state)),
      sections: [
        { key: "in_progress" as const, label: "In progress" },
        { key: "previous" as const, label: "Previous" },
      ],
    };
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
        description="Completed, missed, and in-progress attempts. Incoming scheduled tests are on your Dashboard."
      />

      {sections.map((sec) => {
        const items = rows.filter((r) =>
          sec.key === "in_progress"
            ? r.state === "in_progress"
            : r.state === "result" ||
              r.state === "missed" ||
              r.state === "not_eligible"
        );
        if (items.length === 0) return null;
        return (
          <div key={sec.key} className="grid gap-3">
            <SectionHeading title={sec.label} />
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map(({ t, attempt, state }) => {
                const s = t.subjects as unknown as { name: string } | null;
                const qc = t.question_count;
                return (
                  <Card key={t.id} className="shadow-none">
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <CardTitle className="text-base text-[#072855]">
                          {t.title}
                        </CardTitle>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <Badge variant="outline">
                            {testPricingLabel(t.entitlement)}
                          </Badge>
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
                        {qc} MCQs · {t.duration_minutes} minutes
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

                      {state === "in_progress" && (
                        <Button asChild className="w-fit">
                          <Link href={`/tests/${t.id}/attempt`}>
                            Resume test
                          </Link>
                        </Button>
                      )}
                      {state === "result" && attempt && (
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
                      {prepByTest.get(t.id) &&
                        (state === "upcoming" ||
                          state === "available" ||
                          state === "in_progress" ||
                          state === "result") && (
                          <div className="rounded-lg border bg-muted/40 p-3">
                            <p className="mb-1 text-xs font-semibold tracking-wide text-[#05AEA9] uppercase">
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
          title="No test history yet"
          description="Incoming scheduled tests appear on your Dashboard. Completed, missed, and in-progress attempts appear here."
        />
      )}
    </StudentPage>
  );
}
