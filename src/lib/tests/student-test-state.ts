/**
 * Student test-list state classification (8J-F).
 * Canonical: docs/access-eligibility-analytics.md §§7–9, gap register §19.
 * No eligibility snapshot — forward-compatible overlap heuristic only.
 * Does not create attempts or assign scores.
 */

export type StudentTestListState =
  | "in_progress"
  | "result"
  | "available"
  | "locked"
  | "upcoming"
  | "missed"
  | "not_eligible";

export type StudentTestListSection = "available" | "upcoming" | "previous";

export type AttemptStateForList = "in_progress" | "submitted" | null;

export type TestEntitlementKind = "free" | "any_subscription" | "plan";

export type StudentTestStateInput = {
  nowMs: number;
  opensAtMs: number;
  closesAtMs: number;
  /** tests.status — closed/invalidated force window closed. */
  testStatus: string;
  entitlement: TestEntitlementKind | string;
  /** Current can_access_test (content). Not historical eligibility. */
  currentlyEntitled: boolean;
  attemptState: AttemptStateForList;
  /**
   * Partial historical clues (docs §7): subscription starts_at/ends_at
   * overlapped the test window.
   */
  subscriptionOverlappedWindow: boolean;
  /**
   * Partial historical clues: a test grant was live at some point overlapping
   * the window (created before close; not revoked before open).
   */
  grantOverlappedWindow: boolean;
};

/** Whether [aStart,aEnd) overlaps [bStart,bEnd). */
export function intervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number
): boolean {
  if (
    ![aStartMs, aEndMs, bStartMs, bEndMs].every((n) => Number.isFinite(n))
  ) {
    return false;
  }
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

export function subscriptionOverlapsTestWindow(
  startsAtMs: number,
  endsAtMs: number,
  opensAtMs: number,
  closesAtMs: number
): boolean {
  return intervalsOverlap(startsAtMs, endsAtMs, opensAtMs, closesAtMs);
}

/**
 * Grant was available during some part of the window if it existed before
 * close and was not revoked before open.
 */
export function grantOverlapsTestWindow(
  createdAtMs: number,
  revokedAtMs: number | null,
  opensAtMs: number,
  closesAtMs: number
): boolean {
  if (!Number.isFinite(createdAtMs) || createdAtMs >= closesAtMs) return false;
  const effectiveEnd = revokedAtMs ?? Number.POSITIVE_INFINITY;
  return effectiveEnd > opensAtMs;
}

/**
 * Closed-window historical eligibility evidence without a snapshot table.
 * Free entitlement = always had content access. Otherwise require overlap
 * clues. Current entitlement alone must NOT rewrite history (Ahmad case).
 */
export function hadHistoricalAccessEvidence(input: {
  entitlement: string;
  subscriptionOverlappedWindow: boolean;
  grantOverlappedWindow: boolean;
}): boolean {
  if (input.entitlement === "free") return true;
  return (
    input.subscriptionOverlappedWindow || input.grantOverlappedWindow
  );
}

function windowIsClosed(input: StudentTestStateInput): boolean {
  if (input.testStatus === "closed" || input.testStatus === "invalidated") {
    return true;
  }
  return input.nowMs >= input.closesAtMs;
}

function windowNotOpenYet(input: StudentTestStateInput): boolean {
  return input.nowMs < input.opensAtMs;
}

/**
 * Deterministic test-list state.
 * Priority: attempt → current window → current access → historical heuristic.
 */
export function getStudentTestListState(
  input: StudentTestStateInput
): StudentTestListState {
  if (input.attemptState === "submitted") return "result";
  if (input.attemptState === "in_progress") return "in_progress";

  if (windowNotOpenYet(input) && !windowIsClosed(input)) {
    return "upcoming";
  }

  if (!windowIsClosed(input)) {
    return input.currentlyEntitled ? "available" : "locked";
  }

  // Closed, no attempt — never invent Missed without evidence.
  if (hadHistoricalAccessEvidence(input)) return "missed";
  return "not_eligible";
}

export function studentTestListSection(
  state: StudentTestListState
): StudentTestListSection {
  switch (state) {
    case "available":
    case "locked":
    case "in_progress":
      return "available";
    case "upcoming":
      return "upcoming";
    case "result":
    case "missed":
    case "not_eligible":
      return "previous";
  }
}

export function studentTestListLabel(state: StudentTestListState): string {
  switch (state) {
    case "in_progress":
      return "In progress";
    case "result":
      return "Result";
    case "available":
      return "Available";
    case "locked":
      return "Locked";
    case "upcoming":
      return "Not open yet";
    case "missed":
      return "Missed";
    case "not_eligible":
      return "Not eligible";
  }
}

export type CatalogTestForState = {
  id: string;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  entitlement: string | null;
};

export type CatalogAttemptForState = {
  test_id: string;
  state: string;
};

export type CatalogSubscriptionForState = {
  starts_at: string;
  ends_at: string;
};

export type CatalogGrantForState = {
  test_id: string;
  created_at: string;
  revoked_at: string | null;
};

/**
 * Batch-classify catalog tests with the same 8J-F rules (no N+1).
 * Used by the Tests page and Dashboard participation labels.
 */
export function classifyCatalogTestStates(input: {
  nowMs: number;
  tests: readonly CatalogTestForState[];
  attempts: readonly CatalogAttemptForState[];
  accessibleIds: readonly string[];
  subscriptions: readonly CatalogSubscriptionForState[];
  grants: readonly CatalogGrantForState[];
}): StudentTestListState[] {
  const entitled = new Set(input.accessibleIds);
  const attemptByTest = new Map<string, CatalogAttemptForState>();
  for (const a of input.attempts) {
    const prev = attemptByTest.get(a.test_id);
    if (!prev || a.state === "submitted") attemptByTest.set(a.test_id, a);
  }

  return input.tests.map((t) => {
    const opensAtMs = t.opens_at ? new Date(t.opens_at).getTime() : 0;
    const closesAtMs = t.closes_at ? new Date(t.closes_at).getTime() : 0;
    const attempt = attemptByTest.get(t.id) ?? null;
    let attemptState: AttemptStateForList = null;
    if (attempt?.state === "submitted") attemptState = "submitted";
    else if (attempt?.state === "in_progress") attemptState = "in_progress";

    const subscriptionOverlappedWindow = input.subscriptions.some((s) =>
      subscriptionOverlapsTestWindow(
        new Date(s.starts_at).getTime(),
        new Date(s.ends_at).getTime(),
        opensAtMs,
        closesAtMs
      )
    );
    const grantOverlappedWindow = input.grants.some(
      (g) =>
        g.test_id === t.id &&
        grantOverlapsTestWindow(
          new Date(g.created_at).getTime(),
          g.revoked_at ? new Date(g.revoked_at).getTime() : null,
          opensAtMs,
          closesAtMs
        )
    );

    return getStudentTestListState({
      nowMs: input.nowMs,
      opensAtMs,
      closesAtMs,
      testStatus: t.status,
      entitlement: t.entitlement ?? "free",
      currentlyEntitled: entitled.has(t.id),
      attemptState,
      subscriptionOverlappedWindow,
      grantOverlappedWindow,
    });
  });
}
