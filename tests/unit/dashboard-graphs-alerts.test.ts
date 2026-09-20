import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDashboardAlerts } from "../../src/lib/dashboard/build-alerts.ts";
import {
  adaptLifetimeSummaryBars,
  adaptStudentTrendForChart,
} from "../../src/lib/dashboard/trend-chart-adapter.ts";

describe("adaptStudentTrendForChart", () => {
  it("passes through RPC percentages without recalculating", () => {
    const series = adaptStudentTrendForChart([
      {
        test_id: "1",
        title: "Test A",
        percentage: 70,
        submitted_at: "2026-01-01T00:00:00Z",
      },
      {
        test_id: "2",
        title: "Test B",
        percentage: 85,
        submitted_at: "2026-02-01T00:00:00Z",
      },
    ]);
    assert.equal(series.empty, false);
    assert.equal(series.points.length, 2);
    assert.equal(series.points[0]!.percentage, 70);
    assert.equal(series.points[1]!.percentage, 85);
    assert.equal(series.points[0]!.shortLabel, "T1");
    assert.equal(series.maxPercentage, 100);
  });

  it("empty history when no trend rows", () => {
    const series = adaptStudentTrendForChart([]);
    assert.equal(series.empty, true);
    assert.equal(series.points.length, 0);
  });
});

describe("adaptLifetimeSummaryBars", () => {
  it("marks empty when no tests taken", () => {
    assert.equal(adaptLifetimeSummaryBars(null).empty, true);
    assert.equal(
      adaptLifetimeSummaryBars({ tests_taken: 0, average_percentage: 0 })
        .empty,
      true
    );
  });

  it("keeps summary averages as-is", () => {
    const bars = adaptLifetimeSummaryBars({
      tests_taken: 4,
      average_percentage: 66.5,
      best_percentage: 90,
    });
    assert.equal(bars.empty, false);
    assert.equal(bars.averagePercentage, 66.5);
    assert.equal(bars.bestPercentage, 90);
  });
});

describe("buildDashboardAlerts", () => {
  const nowMs = Date.parse("2026-09-20T12:00:00Z");

  it("includes access banner for free students", () => {
    const alerts = buildDashboardAlerts({
      accessKind: "free",
      accessBanner: {
        title: "Free access",
        description: "Paid items stay locked.",
      },
      incoming: [],
      nowMs,
    });
    assert.equal(alerts[0]?.id, "access-free");
    assert.equal(alerts[0]?.ctaLabel, "My subscription");
  });

  it("flags tests opening within 24 hours", () => {
    const alerts = buildDashboardAlerts({
      accessKind: "subscribed",
      accessBanner: null,
      incoming: [
        {
          id: "t1",
          title: "Soon",
          opens_at: "2026-09-20T20:00:00Z",
          state: "upcoming",
        },
      ],
      nowMs,
    });
    assert.ok(alerts.some((a) => a.id === "opens-soon-t1"));
  });

  it("does not invent alerts when nothing applies", () => {
    const alerts = buildDashboardAlerts({
      accessKind: "subscribed",
      accessBanner: null,
      incoming: [],
      nowMs,
    });
    assert.equal(alerts.length, 0);
  });
});
