import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Dashboard Performance v3 — Suspense boundaries + shell vs deferred RPCs.
 */
function read(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("dashboard suspense boundaries (v3)", () => {
  const page = read("src/app/(student)/dashboard/page.tsx");
  const paid = read("src/components/dashboard/dashboard-paid-section.tsx");
  const historical = read(
    "src/components/dashboard/dashboard-historical-section.tsx"
  );
  const recent = read("src/components/dashboard/dashboard-recent-section.tsx");
  const leaderboard = read(
    "src/components/dashboard/dashboard-leaderboard-section.tsx"
  );

  it("keeps finalizeOwnExpiredAttempts before the shell Promise.all", () => {
    const fi = page.indexOf("await finalizeOwnExpiredAttempts");
    const po = page.indexOf("await Promise.all");
    assert.ok(fi >= 0 && po >= 0 && fi < po);
  });

  it("wraps deferred sections in Suspense with fallbacks", () => {
    assert.match(page, /import\s*\{\s*Suspense\s*\}/);
    assert.match(page, /<Suspense\s+fallback=\{<DashboardLeaderboardFallback/);
    assert.match(page, /<Suspense\s+fallback=\{<DashboardHistoricalFallback/);
    assert.match(page, /<Suspense\s+fallback=\{<DashboardPaidFallback/);
    assert.match(page, /<Suspense\s+fallback=\{<DashboardRecentFallback/);
    assert.match(page, /DashboardLeaderboardSection/);
    assert.match(page, /DashboardHistoricalSection/);
    assert.match(page, /DashboardPaidSection/);
    assert.match(page, /DashboardRecentSection/);
  });

  it("executes only one tests table fetch on the dashboard page", () => {
    const fromTests = page.match(/\.from\(\s*["']tests["']\s*\)/g) ?? [];
    assert.equal(fromTests.length, 1);
    assert.doesNotMatch(leaderboard, /\.from\(\s*["']tests["']\s*\)/);
  });

  it("passes catalog candidates into the leaderboard section (no second /tests)", () => {
    assert.match(page, /leaderboardCandidates/);
    assert.match(
      page,
      /<DashboardLeaderboardSection[\s\S]*candidates=\{leaderboardCandidates\}/
    );
    assert.match(leaderboard, /loadLastCompletedLeaderboardBoard/);
    assert.match(leaderboard, /candidates/);
  });

  it("keeps shell RPCs out of deferred historical/recent/paid sections on the page fan-out", () => {
    // Shell Promise.all must not include deferred RPCs.
    const fanOutStart = page.indexOf("await Promise.all");
    const fanOutEnd = page.indexOf("]);", fanOutStart);
    assert.ok(fanOutStart >= 0 && fanOutEnd > fanOutStart);
    const fanOut = page.slice(fanOutStart, fanOutEnd);
    assert.doesNotMatch(fanOut, /student_test_summary/);
    assert.doesNotMatch(fanOut, /student_recent_tests/);
    assert.doesNotMatch(fanOut, /student_trend/);
    assert.doesNotMatch(fanOut, /student_subject_performance/);
    assert.doesNotMatch(fanOut, /student_weak_chapters/);
    assert.doesNotMatch(fanOut, /test_leaderboard_projection/);
    assert.doesNotMatch(fanOut, /loadLastCompletedLeaderboardBoard/);
  });

  it("defers summary/trend/recent RPCs into their section components", () => {
    assert.match(historical, /student_test_summary/);
    assert.match(historical, /student_trend/);
    assert.match(recent, /student_recent_tests/);
    assert.doesNotMatch(page, /student_test_summary/);
    assert.doesNotMatch(page, /student_recent_tests/);
    assert.doesNotMatch(page, /student_trend/);
  });

  it("gates paid analytics RPCs behind live-access re-check in paid section", () => {
    assert.match(paid, /getStudentHasLiveSubscription/);
    assert.match(paid, /studentHasPaidLmsSections\(hasLiveAccess\)/);
    assert.match(paid, /student_subject_performance/);
    assert.match(paid, /student_weak_chapters/);
    // Page must not call paid RPCs; free lock card is shell-only.
    assert.doesNotMatch(page, /student_subject_performance/);
    assert.doesNotMatch(page, /student_weak_chapters/);
    assert.match(page, /paidDetails\s*\?/);
    assert.match(page, /ResourceLockNotice/);
  });

  it("keeps incoming shell + catalog glance on the page (not deferred)", () => {
    assert.match(page, /Incoming tests/);
    assert.match(page, /Your tests at a glance/);
    assert.match(page, /deriveDashboardUpcomingFromCatalog/);
    assert.match(page, /buildDashboardAlerts/);
  });

  it("does not introduce a whole-page loading.tsx for dashboard", () => {
    assert.equal(
      existsSync(
        path.join(process.cwd(), "src/app/(student)/dashboard/loading.tsx")
      ),
      false
    );
  });

  it("isolates deferred section failures with try/catch", () => {
    for (const src of [leaderboard, historical, paid, recent]) {
      assert.match(src, /try\s*\{/);
      assert.match(src, /catch\s*\(/);
    }
  });
});
