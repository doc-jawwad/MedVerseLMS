/**
 * Chart adapters over existing student_trend / summary RPCs.
 * Does not recalculate percentages — passes through submitted history.
 */

export type StudentTrendRpcPoint = {
  test_id: string;
  title: string;
  percentage: number | string;
  submitted_at: string;
};

export type DashboardTrendPoint = {
  testId: string;
  title: string;
  percentage: number;
  submittedAt: string;
  /** Short mobile-friendly label (T1, T2, …). */
  shortLabel: string;
};

export type DashboardTrendSeries = {
  points: DashboardTrendPoint[];
  /** Chart scale ceiling — at least 100 so bars stay honest. */
  maxPercentage: number;
  empty: boolean;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Adapt `student_trend` rows for dashboard / analytics charts.
 * Preserves chronological RPC order; does not recompute scores.
 */
export function adaptStudentTrendForChart(
  raw: unknown
): DashboardTrendSeries {
  if (!Array.isArray(raw)) {
    return { points: [], maxPercentage: 100, empty: true };
  }

  const points: DashboardTrendPoint[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const testId = typeof r.test_id === "string" ? r.test_id : null;
    const title = typeof r.title === "string" ? r.title : null;
    const percentage = asFiniteNumber(r.percentage);
    const submittedAt =
      typeof r.submitted_at === "string" ? r.submitted_at : null;
    if (!testId || !title || percentage == null || !submittedAt) continue;
    points.push({
      testId,
      title,
      percentage,
      submittedAt,
      shortLabel: `T${i + 1}`,
    });
  }

  const maxPercentage = Math.max(
    100,
    ...points.map((p) => p.percentage)
  );

  return {
    points,
    maxPercentage,
    empty: points.length === 0,
  };
}

export type LifetimeSummaryBars = {
  averagePercentage: number;
  bestPercentage: number;
  testsTaken: number;
  empty: boolean;
};

/** Pass-through adapter for student_test_summary bar visuals. */
export function adaptLifetimeSummaryBars(
  summary: {
    tests_taken?: number | null;
    average_percentage?: number | null;
    best_percentage?: number | null;
  } | null
): LifetimeSummaryBars {
  const testsTaken = summary?.tests_taken ?? 0;
  const averagePercentage = asFiniteNumber(summary?.average_percentage) ?? 0;
  const bestPercentage = asFiniteNumber(summary?.best_percentage) ?? 0;
  return {
    averagePercentage,
    bestPercentage,
    testsTaken,
    empty: testsTaken <= 0,
  };
}
