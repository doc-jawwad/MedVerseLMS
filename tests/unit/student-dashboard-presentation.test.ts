import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approximateCatalogEligibleCount,
  buildPaidFeatureLockPreview,
  buildStudentDashboardPresentation,
  countStudentTestListStates,
  dashboardAccessKindFromSubscription,
  isNotEligibleCountedAsMissed,
  PERFORMANCE_GRAIN_COPY,
} from "../../src/lib/tests/student-dashboard-presentation.ts";
import type { StudentTestListState } from "../../src/lib/tests/student-test-state.ts";

const lifetime = {
  tests_taken: 10,
  average_percentage: 72,
  best_percentage: 91,
  average_rank: 4,
};

describe("student dashboard presentation (8J-G)", () => {
  it("free dashboard keeps historical lifetime data and locks paid features", () => {
    const view = buildStudentDashboardPresentation({
      subscriptionKind: "none",
      lifetime,
      catalogStates: ["result", "locked", "not_eligible"],
    });
    assert.equal(view.accessKind, "free");
    assert.equal(view.showHistoricalPerformance, true);
    assert.equal(view.lockPaidCurrentAccess, true);
    assert.equal(view.lifetime.attempted, 10);
    assert.equal(view.lifetime.averagePercentage, 72);
    assert.equal(view.paidFeatureLock.show, true);
    assert.equal(view.paidFeatureLock.protectedPayload, null);
  });

  it("subscribed dashboard unlocks current paid features and keeps history", () => {
    const view = buildStudentDashboardPresentation({
      subscriptionKind: "active",
      lifetime,
      catalogStates: ["available", "result"],
    });
    assert.equal(view.accessKind, "subscribed");
    assert.equal(view.lockPaidCurrentAccess, false);
    assert.equal(view.paidFeatureLock.show, false);
    assert.equal(view.showHistoricalPerformance, true);
    assert.equal(view.lifetime.attempted, 10);
  });

  it("expired dashboard preserves historical performance", () => {
    const view = buildStudentDashboardPresentation({
      subscriptionKind: "expired",
      lifetime,
      catalogStates: ["result", "missed", "locked"],
    });
    assert.equal(view.accessKind, "expired");
    assert.equal(view.showHistoricalPerformance, true);
    assert.equal(view.lifetime.attempted, 10);
    assert.equal(view.lifetime.averagePercentage, 72);
    assert.equal(view.lifetime.bestPercentage, 91);
    assert.ok(view.accessBanner?.title.includes("expired"));
  });

  it("expired dashboard does not expose current paid functionality", () => {
    const view = buildStudentDashboardPresentation({
      subscriptionKind: "expired",
      lifetime,
      catalogStates: ["locked"],
    });
    assert.equal(view.lockPaidCurrentAccess, true);
    assert.equal(view.paidFeatureLock.show, true);
    assert.match(view.paidFeatureLock.body, /locked/i);
  });

  it("paid historical scores are not removed after expiry", () => {
    const before = buildStudentDashboardPresentation({
      subscriptionKind: "active",
      lifetime,
      catalogStates: ["result"],
    });
    const after = buildStudentDashboardPresentation({
      subscriptionKind: "expired",
      lifetime,
      catalogStates: ["result"],
    });
    assert.equal(before.lifetime.attempted, after.lifetime.attempted);
    assert.equal(
      before.lifetime.averagePercentage,
      after.lifetime.averagePercentage
    );
    assert.equal(before.lifetime.bestPercentage, after.lifetime.bestPercentage);
  });

  it("renewal does not duplicate or rewrite history", () => {
    const expired = buildStudentDashboardPresentation({
      subscriptionKind: "expired",
      lifetime,
      catalogStates: ["result", "result"],
    });
    const renewed = buildStudentDashboardPresentation({
      subscriptionKind: "active",
      lifetime,
      catalogStates: ["result", "result", "available"],
    });
    assert.equal(renewed.lifetime.attempted, expired.lifetime.attempted);
    assert.equal(
      renewed.lifetime.averagePercentage,
      expired.lifetime.averagePercentage
    );
  });

  it("does not label Not Eligible as Missed", () => {
    const counts = countStudentTestListStates([
      "not_eligible",
      "not_eligible",
      "missed",
    ]);
    assert.equal(counts.not_eligible, 2);
    assert.equal(counts.missed, 1);
    assert.equal(isNotEligibleCountedAsMissed(counts), false);

    const view = buildStudentDashboardPresentation({
      subscriptionKind: "active",
      lifetime: { ...lifetime, tests_taken: 0 },
      catalogStates: ["not_eligible", "not_eligible", "missed"],
    });
    assert.equal(view.catalog.notEligible, 2);
    assert.equal(view.catalog.missed, 1);
    assert.notEqual(view.catalog.notEligible, view.catalog.missed);
  });

  it("does not invent zero scores for non-eligibility", () => {
    const view = buildStudentDashboardPresentation({
      subscriptionKind: "none",
      lifetime: {
        tests_taken: 0,
        average_percentage: 0,
        best_percentage: 0,
        average_rank: 0,
      },
      catalogStates: ["not_eligible", "not_eligible"],
    });
    assert.equal(view.lifetime.attempted, 0);
    assert.equal(view.catalog.notEligible, 2);
    assert.equal(view.catalog.missed, 0);
    assert.match(view.lifetime.grainNote, /never scored as zero/i);
  });

  it("locked previews contain no protected data", () => {
    for (const kind of ["none", "expired", "pending", "deactivated"] as const) {
      const preview = buildPaidFeatureLockPreview(
        dashboardAccessKindFromSubscription(kind)
      );
      assert.equal(preview.show, true);
      assert.equal(preview.protectedPayload, null);
      assert.equal(
        Object.prototype.hasOwnProperty.call(preview, "protectedPayload"),
        true
      );
    }
  });

  it("lifetime analytics labels remain submitted-only Attempted", () => {
    const view = buildStudentDashboardPresentation({
      subscriptionKind: "active",
      lifetime,
      catalogStates: [],
    });
    assert.equal(view.lifetime.attemptedLabel, "Attempted");
    assert.equal(view.lifetime.attempted, lifetime.tests_taken);
    assert.match(view.lifetime.grainNote, /Lifetime submitted/i);
  });

  it("catalog eligible approx excludes Not eligible and Locked", () => {
    const states: StudentTestListState[] = [
      "result",
      "in_progress",
      "available",
      "missed",
      "not_eligible",
      "locked",
      "upcoming",
    ];
    const counts = countStudentTestListStates(states);
    assert.equal(approximateCatalogEligibleCount(counts), 4);
    assert.equal(counts.not_eligible, 1);
    assert.equal(counts.locked, 1);
  });

  it("maps subscription kinds without inventing new access layers", () => {
    assert.equal(dashboardAccessKindFromSubscription("active"), "subscribed");
    assert.equal(dashboardAccessKindFromSubscription("expired"), "expired");
    assert.equal(dashboardAccessKindFromSubscription("none"), "free");
    assert.equal(dashboardAccessKindFromSubscription("pending"), "pending");
    assert.equal(
      dashboardAccessKindFromSubscription("deactivated"),
      "deactivated"
    );
  });

  it("documents lifetime / current-year / practice-only analytics grains", () => {
    assert.match(PERFORMANCE_GRAIN_COPY.overall, /Lifetime submitted/i);
    assert.match(PERFORMANCE_GRAIN_COPY.subject, /Current enrollment year/i);
    assert.match(PERFORMANCE_GRAIN_COPY.weakChapters, /Lifetime practice/i);
    assert.match(PERFORMANCE_GRAIN_COPY.weakChapters, /not test scores/i);
    assert.match(PERFORMANCE_GRAIN_COPY.trend, /Lifetime submitted/i);
  });
});
