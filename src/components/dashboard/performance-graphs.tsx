import { EmptyState } from "@/components/student/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DashboardTrendSeries,
  LifetimeSummaryBars,
} from "@/lib/dashboard/trend-chart-adapter";
import { PERFORMANCE_GRAIN_COPY } from "@/lib/tests/student-dashboard-presentation";

function SummaryBar({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-[#072855]">{label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {value}%{sub ? ` ${sub}` : ""}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[#05AEA9]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function DashboardPerformanceGraphs({
  trend,
  summary,
}: {
  trend: DashboardTrendSeries;
  summary: LifetimeSummaryBars;
}) {
  return (
    <div className="grid gap-3" data-testid="dashboard-graphs">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[#072855]">
            Score overview
          </CardTitle>
          <CardDescription>{PERFORMANCE_GRAIN_COPY.overall}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {summary.empty ? (
            <EmptyState
              title="No history yet"
              description="Submitted test scores will show here. Missed and not-eligible tests are never scored as zero."
            />
          ) : (
            <>
              <SummaryBar
                label="Average score"
                value={summary.averagePercentage}
                sub={`across ${summary.testsTaken} attempted`}
              />
              <SummaryBar label="Best score" value={summary.bestPercentage} />
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[#072855]">
            Historical trend
          </CardTitle>
          <CardDescription>{PERFORMANCE_GRAIN_COPY.trend}</CardDescription>
        </CardHeader>
        <CardContent>
          {trend.empty ? (
            <EmptyState
              title="No history yet"
              description="Take a formal test to start your lifetime trend. Free and paid submits stay on the same series."
            />
          ) : (
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div
                className="flex h-44 min-w-full items-end gap-2 sm:gap-3"
                style={{
                  width: `max(100%, ${trend.points.length * 2.75}rem)`,
                }}
              >
                {trend.points.map((point) => (
                  <div
                    key={point.testId}
                    className="flex min-w-11 flex-1 flex-col items-center gap-1"
                    title={`${point.title}: ${point.percentage}%`}
                  >
                    <span className="text-[10px] font-medium tabular-nums text-[#072855] sm:text-xs">
                      {point.percentage}%
                    </span>
                    <div
                      className="w-full max-w-12 rounded-t bg-[#05AEA9]"
                      style={{
                        height: `${Math.max(
                          4,
                          (point.percentage / trend.maxPercentage) * 100
                        )}%`,
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground sm:text-xs">
                      {point.shortLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
