import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import {
  classifyCatalogTestStates,
  studentTestListLabel,
  studentTestListSection,
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
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { SectionLock } from "@/components/subscription/section-lock";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { SectionHeading } from "@/components/student/section-heading";
import { EmptyState } from "@/components/student/empty-state";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
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
  const hasLiveAccess = await getStudentHasLiveSubscription();
  if (!studentHasPaidLmsSections(hasLiveAccess)) {
    ssrMarkPageFnEnd();
    return (
      <SectionLock
        title="Tests"
        description="The full tests catalog unlocks with a live subscription. Free and granted tests stay under Free Resources."
      />
    );
  }

  const [
    { data: tests },
    { data: attempts },
    { data: accessible },
    { data: subscriptions },
    { data: grants },
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
        section: studentTestListSection(state),
      };
    });

    return {
      rows,
      sections: [
        { key: "available" as const, label: "Available now" },
        { key: "upcoming" as const, label: "Upcoming" },
        { key: "previous" as const, label: "Previous" },
      ],
    };
  });

  ssrMarkPageFnEnd();

  return (
    <StudentPage>
      <PageHeader
        title="Tests"
        description="Missed means you could have sat the test and did not. Not eligible means the test was not available to you during its window. Neither is a score of zero."
      />

      {sections.map((sec) => {
        const items = rows.filter((r) => r.section === sec.key);
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
                        <Badge
                          variant={
                            state === "available" || state === "in_progress"
                              ? "default"
                              : state === "result"
                                ? "secondary"
                                : "outline"
                          }
                          className="w-fit shrink-0"
                        >
                          {studentTestListLabel(state)}
                        </Badge>
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

                      {state === "available" && (
                        <Button asChild className="w-fit">
                          <Link href={`/tests/${t.id}/attempt`}>Start test</Link>
                        </Button>
                      )}
                      {state === "in_progress" && (
                        <Button asChild className="w-fit">
                          <Link href={`/tests/${t.id}/attempt`}>
                            Resume test
                          </Link>
                        </Button>
                      )}
                      {state === "locked" && <ResourceLockNotice />}
                      {state === "upcoming" && (
                        <p className="text-muted-foreground">
                          This test is not open yet.
                        </p>
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
          title="No tests assigned to you yet"
          description="When your academy publishes a test for your year, it will appear here."
        />
      )}
    </StudentPage>
  );
}
