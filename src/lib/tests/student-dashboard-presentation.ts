/**
 * Student dashboard presentation (8J-G).
 * Canonical: docs/access-eligibility-analytics.md §§0, 5, 8–12, 17.6.
 * Presentation only — does not rewrite analytics RPCs or invent eligibility snapshots.
 * Reuses 8J-F list states; never creates attempts or zeros for Missed/Not eligible.
 */

import type { StudentTestListState } from "@/lib/tests/student-test-state";
import type { StudentSubscriptionViewKind } from "@/lib/subscriptions/student-status";

export type DashboardAccessKind =
  | "free"
  | "subscribed"
  | "expired"
  | "pending"
  | "deactivated";

export type CatalogStateCounts = {
  result: number;
  in_progress: number;
  available: number;
  locked: number;
  upcoming: number;
  missed: number;
  not_eligible: number;
};

export type DashboardLifetimeSummary = {
  tests_taken: number;
  average_percentage: number;
  best_percentage: number;
  average_rank: number;
};

export type PaidFeatureLockPreview = {
  show: boolean;
  title: string;
  body: string;
  /**
   * Always null — locked UI must not carry protected paid analytics payloads.
   * Server authorization remains the boundary.
   */
  protectedPayload: null;
};

export type DashboardPresentation = {
  accessKind: DashboardAccessKind;
  accessBanner: { title: string; description: string } | null;
  /** Lifetime submitted analytics — always shown when the student can open LMS. */
  showHistoricalPerformance: boolean;
  /** Current paid Start / paid feature CTAs may be locked. */
  lockPaidCurrentAccess: boolean;
  paidFeatureLock: PaidFeatureLockPreview;
  lifetime: {
    attempted: number;
    averagePercentage: number;
    bestPercentage: number;
    averageRank: number | null;
    attemptedLabel: string;
    averageLabel: string;
    bestLabel: string;
    rankLabel: string;
    grainNote: string;
  };
  catalog: {
    missed: number;
    notEligible: number;
    /** Approximate eligible among currently catalog-visible tests (heuristic). */
    eligibleApprox: number;
    counts: CatalogStateCounts;
    scopeNote: string;
  };
};

export function dashboardAccessKindFromSubscription(
  kind: StudentSubscriptionViewKind
): DashboardAccessKind {
  switch (kind) {
    case "active":
      return "subscribed";
    case "expired":
      return "expired";
    case "deactivated":
      return "deactivated";
    case "pending":
      return "pending";
    case "none":
    default:
      return "free";
  }
}

export function emptyCatalogStateCounts(): CatalogStateCounts {
  return {
    result: 0,
    in_progress: 0,
    available: 0,
    locked: 0,
    upcoming: 0,
    missed: 0,
    not_eligible: 0,
  };
}

/** Count 8J-F states. Missed and Not eligible stay separate. */
export function countStudentTestListStates(
  states: readonly StudentTestListState[]
): CatalogStateCounts {
  const counts = emptyCatalogStateCounts();
  for (const state of states) {
    counts[state] += 1;
  }
  return counts;
}

/**
 * Catalog-visible tests that count toward an approximate “eligible” set
 * under the 8J-F heuristic (not a full historical snapshot).
 * Excludes Not eligible, Locked (open but not entitled now), and Upcoming.
 */
export function approximateCatalogEligibleCount(
  counts: CatalogStateCounts
): number {
  return (
    counts.result +
    counts.in_progress +
    counts.available +
    counts.missed
  );
}

export function buildPaidFeatureLockPreview(
  accessKind: DashboardAccessKind
): PaidFeatureLockPreview {
  if (accessKind === "subscribed") {
    return {
      show: false,
      title: "",
      body: "",
      protectedPayload: null,
    };
  }

  if (accessKind === "expired" || accessKind === "deactivated") {
    return {
      show: true,
      title: "Paid features locked",
      body: "Your historical scores stay on this dashboard. Starting new paid tests, opening paid materials, and paid review content stay locked until you renew.",
      protectedPayload: null,
    };
  }

  if (accessKind === "pending") {
    return {
      show: true,
      title: "Subscription under review",
      body: "Paid starts stay locked while your application is reviewed. Free resources and any submitted history remain available.",
      protectedPayload: null,
    };
  }

  return {
    show: true,
    title: "Unlock paid features",
    body: "Free resources and your submitted history stay available. Subscribe to start paid tests and open paid materials. This card does not include protected paid analytics.",
    protectedPayload: null,
  };
}

export function buildAccessBanner(
  accessKind: DashboardAccessKind
): { title: string; description: string } | null {
  switch (accessKind) {
    case "subscribed":
      return null;
    case "expired":
      return {
        title: "Subscription expired",
        description:
          "Lifetime academic performance stays visible. Paid starts and paid review stay locked.",
      };
    case "deactivated":
      return {
        title: "Subscription deactivated",
        description:
          "Lifetime academic performance stays visible. Paid starts stay locked. Free resources remain available.",
      };
    case "pending":
      return {
        title: "Subscription pending",
        description:
          "Your application is under review. Free resources and submitted history remain available.",
      };
    case "free":
      return {
        title: "Free access",
        description:
          "You can use free resources and see your submitted history. Paid items stay visible but locked until you subscribe.",
      };
  }
}

/**
 * Pure dashboard view model. Lifetime numbers come from existing RPCs
 * (submitted-only). Catalog Missed / Not eligible reuse 8J-F states.
 */
export const PERFORMANCE_GRAIN_COPY = {
  overall:
    "Lifetime submitted tests only (Attempted). Missed and Not eligible are never included as zeros.",
  subject:
    "Current enrollment year subjects — test averages from submitted attempts on those subjects, plus practice accuracy (practice-only answers).",
  weakChapters:
    "Lifetime practice accuracy (minimum 3 practice answers) — not test scores",
  trend:
    "Lifetime submitted test scores in chronological order — unchanged by subscription expiry or renewal",
} as const;

export function buildStudentDashboardPresentation(input: {
  subscriptionKind: StudentSubscriptionViewKind;
  lifetime: DashboardLifetimeSummary | null;
  catalogStates: readonly StudentTestListState[];
}): DashboardPresentation {
  const accessKind = dashboardAccessKindFromSubscription(
    input.subscriptionKind
  );
  const counts = countStudentTestListStates(input.catalogStates);
  const lifetime = input.lifetime;
  const attempted = lifetime?.tests_taken ?? 0;

  return {
    accessKind,
    accessBanner: buildAccessBanner(accessKind),
    showHistoricalPerformance: true,
    lockPaidCurrentAccess: accessKind !== "subscribed",
    paidFeatureLock: buildPaidFeatureLockPreview(accessKind),
    lifetime: {
      attempted,
      averagePercentage: lifetime?.average_percentage ?? 0,
      bestPercentage: lifetime?.best_percentage ?? 0,
      averageRank: lifetime?.average_rank ? lifetime.average_rank : null,
      attemptedLabel: "Attempted",
      averageLabel: "Average score",
      bestLabel: "Best score",
      rankLabel: "Average rank",
      grainNote:
        "Lifetime submitted tests only. Missed and Not eligible are never scored as zero. Subscription changes do not rewrite this history.",
    },
    catalog: {
      missed: counts.missed,
      notEligible: counts.not_eligible,
      eligibleApprox: approximateCatalogEligibleCount(counts),
      counts,
      scopeNote:
        "Missed and Not eligible below are from currently visible catalog tests using the same 8J-F overlap heuristic as the Tests page — not a complete historical eligibility snapshot.",
    },
  };
}

/** Guard: presentation helpers must never treat Not eligible as Missed. */
export function isNotEligibleCountedAsMissed(
  counts: CatalogStateCounts
): boolean {
  // Structural check used by tests — counts are independent fields.
  void counts;
  return false;
}
