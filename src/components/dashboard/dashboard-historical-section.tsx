import { requireStudent } from "@/lib/auth/require-user";
import { StatTile } from "@/components/student/stat-tile";
import { SectionHeading } from "@/components/student/section-heading";
import { EmptyState } from "@/components/student/empty-state";
import { DashboardPerformanceGraphs } from "@/components/dashboard/performance-graphs";
import {
  adaptLifetimeSummaryBars,
  adaptStudentTrendForChart,
  type DashboardTrendSeries,
  type LifetimeSummaryBars,
} from "@/lib/dashboard/trend-chart-adapter";
import { buildStudentDashboardPresentation } from "@/lib/tests/student-dashboard-presentation";
import type { StudentSubscriptionViewKind } from "@/lib/subscriptions/student-status";

type LifetimeSummary = {
  tests_taken: number;
  average_percentage: number;
  best_percentage: number;
  average_rank: number;
};

/**
 * Deferred lifetime tiles + trend graphs.
 * Fetches student_test_summary + student_trend only.
 */
export async function DashboardHistoricalSection({
  subscriptionKind,
}: {
  subscriptionKind: StudentSubscriptionViewKind;
}) {
  let failed = false;
  let lifetime: ReturnType<
    typeof buildStudentDashboardPresentation
  >["lifetime"] | null = null;
  let showHistorical = true;
  let trendSeries: DashboardTrendSeries = {
    points: [],
    maxPercentage: 100,
    empty: true,
  };
  let summaryBars: LifetimeSummaryBars = {
    averagePercentage: 0,
    bestPercentage: 0,
    testsTaken: 0,
    empty: true,
  };

  try {
    const { supabase } = await requireStudent();
    const [{ data: summary }, { data: trend }] = await Promise.all([
      supabase.rpc("student_test_summary"),
      supabase.rpc("student_trend"),
    ]);

    const s = (summary ?? null) as LifetimeSummary | null;
    const presentation = buildStudentDashboardPresentation({
      subscriptionKind,
      lifetime: s,
      catalogStates: [],
    });
    showHistorical = presentation.showHistoricalPerformance;
    lifetime = presentation.lifetime;
    trendSeries = adaptStudentTrendForChart(trend);
    summaryBars = adaptLifetimeSummaryBars(s);
  } catch (err) {
    console.error("dashboard historical section failed", err);
    failed = true;
  }

  if (failed || !lifetime) {
    return (
      <div className="grid gap-3" data-testid="dashboard-historical-error">
        <EmptyState
          title="Lifetime performance unavailable"
          description="Could not load lifetime scores. Refresh to try again."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3" data-testid="dashboard-historical">
      {showHistorical && (
        <div className="grid gap-3">
          <SectionHeading
            title="Lifetime performance"
            description={lifetime.grainNote}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label={lifetime.attemptedLabel}
              value={String(lifetime.attempted)}
            />
            <StatTile
              label={lifetime.averageLabel}
              value={`${lifetime.averagePercentage}%`}
            />
            <StatTile
              label={lifetime.bestLabel}
              value={`${lifetime.bestPercentage}%`}
            />
            <StatTile
              label={lifetime.rankLabel}
              value={
                lifetime.averageRank ? `#${lifetime.averageRank}` : "—"
              }
            />
          </div>
        </div>
      )}
      <DashboardPerformanceGraphs trend={trendSeries} summary={summaryBars} />
    </div>
  );
}
