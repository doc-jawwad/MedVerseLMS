import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PERFORMANCE_GRAIN_COPY } from "@/lib/tests/student-dashboard-presentation";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import { LeaderboardBoardCard } from "@/components/dashboard/leaderboard-board-card";
import { DashboardPerformanceGraphs } from "@/components/dashboard/performance-graphs";
import {
  adaptLifetimeSummaryBars,
  adaptStudentTrendForChart,
} from "@/lib/dashboard/trend-chart-adapter";
import {
  analyticsTop20Limit,
  loadLastCompletedLeaderboardBoard,
} from "@/lib/leaderboard/load-last-completed-board";

export const metadata = { title: "Performance — MedVerse LMS" };

type SubjectPerf = {
  subject_id: string;
  subject_name: string;
  test_average_percentage: number;
  tests_taken: number;
  practice_accuracy: number;
  practice_answered: number;
};

type WeakChapter = {
  chapter_id: string;
  chapter_name: string;
  subject_name: string;
  accuracy: number;
  answered: number;
};

function Bar({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {value}% {sub}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--brand-teal)] transition-all"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export default async function PerformancePage() {
  const { supabase, userId } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();
  const paidDetails = studentHasPaidLmsSections(hasLiveAccess);
  const nowMs = Date.now();

  const baseFetches = await Promise.all([
    supabase.rpc("student_test_summary"),
    supabase.rpc("student_trend"),
    supabase
      .from("tests")
      .select("id, title, status, opens_at, closes_at, entitlement"),
  ]);

  const [{ data: summary }, { data: trend }, { data: catalogTests }] = baseFetches;

  let subjectRows: SubjectPerf[] = [];
  let weakRows: WeakChapter[] = [];
  if (paidDetails) {
    const [{ data: subjects }, { data: weak }] = await Promise.all([
      supabase.rpc("student_subject_performance"),
      supabase.rpc("student_weak_chapters", { p_limit: 5 }),
    ]);
    subjectRows = (subjects ?? []) as SubjectPerf[];
    weakRows = (weak ?? []) as WeakChapter[];
  }

  const s = summary as {
    tests_taken: number;
    average_percentage: number;
    best_percentage: number;
    average_rank: number;
  } | null;
  const trendSeries = adaptStudentTrendForChart(trend);
  const summaryBars = adaptLifetimeSummaryBars(s);

  const top20Board = await loadLastCompletedLeaderboardBoard(supabase, {
    candidates: (catalogTests ?? []).map((t) => ({
      id: t.id as string,
      title: (t.title as string) ?? "",
      status: t.status as string,
      closes_at: (t.closes_at as string | null) ?? null,
      opens_at: (t.opens_at as string | null) ?? null,
      entitlement: (t.entitlement as string | null) ?? null,
    })),
    nowMs,
    limit: analyticsTop20Limit(),
  });

  return (
    <StudentPage>
      <PageHeader
        title="Performance"
        description="Lifetime submitted scores and the last-test Top 20 stay available. Subject and practice drills unlock with a live subscription."
      />

      <LeaderboardBoardCard
        title="Analytics leaderboard"
        description="Top 20 from the most recently completed formal test. Same rank_test source as the dashboard Top 3."
        board={top20Board}
        viewerStudentId={userId}
      />

      <DashboardPerformanceGraphs trend={trendSeries} summary={summaryBars} />

      {paidDetails ? (
        <>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base text-[var(--student-ink)]">Overall</CardTitle>
              <CardDescription>
                {PERFORMANCE_GRAIN_COPY.overall}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Bar
                label="Average test score"
                value={s?.average_percentage ?? 0}
                sub={`across ${s?.tests_taken ?? 0} attempted`}
              />
              <Bar label="Best score" value={s?.best_percentage ?? 0} />
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base text-[var(--student-ink)]">
                Subject performance
              </CardTitle>
              <CardDescription>
                {PERFORMANCE_GRAIN_COPY.subject}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {subjectRows.map((sub) => (
                <div key={sub.subject_id} className="grid gap-2">
                  <p className="text-sm font-medium">{sub.subject_name}</p>
                  <Bar
                    label="Tests"
                    value={sub.test_average_percentage}
                    sub={`(${sub.tests_taken})`}
                  />
                  <Bar
                    label="Practice"
                    value={sub.practice_accuracy}
                    sub={`(${sub.practice_answered} answered)`}
                  />
                </div>
              ))}
              {subjectRows.length === 0 && (
                <EmptyState title="No data yet." />
              )}
            </CardContent>
          </Card>

          {weakRows.length > 0 && (
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base text-[var(--student-ink)]">
                  Weak chapters
                </CardTitle>
                <CardDescription>
                  {PERFORMANCE_GRAIN_COPY.weakChapters}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {weakRows.map((w) => (
                  <div
                    key={w.chapter_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>
                      {w.chapter_name}{" "}
                      <span className="text-muted-foreground">
                        ({w.subject_name})
                      </span>
                    </span>
                    <Badge variant={w.accuracy < 50 ? "destructive" : "outline"}>
                      {w.accuracy}% ({w.answered})
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="border-dashed shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-[var(--student-ink)]">
              Subject & practice analytics
            </CardTitle>
            <CardDescription>
              Lifetime score graphs and the Top 20 board stay available. Subject
              bars and weak chapters unlock with a live subscription.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ResourceLockNotice />
            <Button asChild size="sm" variant="secondary" className="w-fit">
              <Link href="/subscription">My subscription</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </StudentPage>
  );
}
