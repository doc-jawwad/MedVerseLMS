/**
 * Student test-list state classification (8J-F).
 * Canonical: docs/access-eligibility-analytics.md §§7–9, gap register §19.
 * No eligibility snapshot — forward-compatible overlap heuristic only.
 * Does not create attempts or assign scores.
 */

export type StudentTestListState =
  | "in_progress"
  | "result"
  | "retake_available"
  | "available"
  | "locked"
  | "upcoming"
  | "missed"
  | "not_eligible";

export type StudentTestListSection = "available" | "upcoming" | "previous";

export type AttemptStateForList = "in_progress" | "submitted" | null;

export type TestEntitlementKind = "free" | "any_subscription" | "plan";

/** exam-state-machine.md: auto_submit_expired / finalize_if_expired sweep. */
export const AUTO_SUBMIT_SWEEP_MS = 60_000;

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
   * tests.max_attempts (default 1). Reattempts are enabled iff > 1.
   * docs/test-rules.md "Attempt limit and reattempts".
   */
  maxAttempts?: number;
  /**
   * Counted attempts (in_progress + submitted; invalidated never count).
   * Defaults to 1 when attemptState is set, else 0.
   */
  countedAttempts?: number;
  /**
   * Server `test_attempts.expires_at`. Required to hide Resume after the
   * effective deadline; omitted/null is treated as still live.
   */
  expiresAtMs?: number | null;
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
 * Resume is the same in_progress attempt until the auto-submit sweep.
 * After expires_at + 60s the paper must present as ended (result), not Resume.
 */
export function isResumeEligibleInProgress(input: {
  attemptState: AttemptStateForList;
  nowMs: number;
  expiresAtMs?: number | null;
}): boolean {
  if (input.attemptState !== "in_progress") return false;
  if (input.expiresAtMs == null) return true;
  return input.nowMs < input.expiresAtMs + AUTO_SUBMIT_SWEEP_MS;
}

/**
 * Derived display only (not an attempt state): another attempt is permitted
 * right now. start_attempt remains the authority.
 */
export function isRetakeAvailable(input: StudentTestStateInput): boolean {
  const max = input.maxAttempts ?? 1;
  if (max <= 1) return false;
  const counted =
    input.countedAttempts ?? (input.attemptState === null ? 0 : 1);
  if (counted < 1 || counted >= max) return false;
  if (windowNotOpenYet(input) || windowIsClosed(input)) return false;
  return input.currentlyEntitled;
}

/**
 * Deterministic test-list state.
 * Priority: attempt → current window → current access → historical heuristic.
 * A live in_progress attempt wins over Retake available / Result.
 */
export function getStudentTestListState(
  input: StudentTestStateInput
): StudentTestListState {
  if (isResumeEligibleInProgress(input)) return "in_progress";
  if (input.attemptState === "in_progress") return "result";
  if (input.attemptState === "submitted") {
    return isRetakeAvailable(input) ? "retake_available" : "result";
  }

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
    case "retake_available":
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

export function isIncomingDashboardTest(
  state: StudentTestListState
): boolean {
  return (
    state === "upcoming" ||
    state === "available" ||
    state === "retake_available" ||
    state === "locked" ||
    state === "in_progress"
  );
}

/**
 * @deprecated Tests page shows the full catalog (§2). Kept for callers that
 * still mean "previous + in-progress history slice".
 */
export function isHistoryTestsPageState(
  state: StudentTestListState
): boolean {
  return (
    state === "result" ||
    state === "missed" ||
    state === "not_eligible" ||
    state === "in_progress"
  );
}

/** Four student Tests-page sections (docs/access-eligibility-analytics.md §2). */
export type StudentTestsPageSection =
  | "upcoming"
  | "available"
  | "in_progress"
  | "previous";

export function studentTestsPageSection(
  state: StudentTestListState
): StudentTestsPageSection {
  switch (state) {
    case "upcoming":
      return "upcoming";
    case "available":
    case "retake_available":
    case "locked":
      return "available";
    case "in_progress":
      return "in_progress";
    case "result":
    case "missed":
    case "not_eligible":
      return "previous";
  }
}

/** Every classified catalog state appears on the Tests page. */
export function isStudentTestsPageState(
  state: StudentTestListState
): boolean {
  void state;
  return true;
}

export function testPricingLabel(
  entitlement: string | null | undefined
): "FREE" | "PAID" {
  return entitlement === "free" ? "FREE" : "PAID";
}

/** Student-facing MCQ count: "1 MCQ" / "2 MCQs". */
export function formatMcqCount(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return n === 1 ? "1 MCQ" : `${n} MCQs`;
}

/**
 * Prefer the FREE/PAID badge as the audience indicator. Strips a redundant
 * leading FREE/PAID token from the displayed title only — DB title unchanged.
 * Only exact uppercase FREE/PAID prefixes are removed so real titles are kept.
 */
export function displayTestTitle(
  title: string,
  pricing: "FREE" | "PAID"
): string {
  const trimmed = title.trim();
  const re =
    pricing === "FREE"
      ? /^(FREE)(?:\s*[-–—:]\s*|\s+)/
      : /^(PAID)(?:\s*[-–—:]\s*|\s+)/;
  const stripped = trimmed.replace(re, "").trim();
  return stripped.length > 0 ? stripped : trimmed;
}

export function studentTestListLabel(state: StudentTestListState): string {
  switch (state) {
    case "in_progress":
      return "In progress";
    case "result":
      return "Result";
    case "available":
      return "Available";
    case "retake_available":
      return "Retake available";
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
  /** tests.max_attempts; null/undefined = 1. */
  max_attempts?: number | null;
};

export type CatalogAttemptForState = {
  test_id: string;
  state: string;
  expires_at?: string | null;
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
  // Per test: a live in_progress attempt wins; else any submitted; plus the
  // counted total (invalidated rows are never passed in / never counted).
  const attemptByTest = new Map<string, CatalogAttemptForState>();
  const countedByTest = new Map<string, number>();
  for (const a of input.attempts) {
    if (a.state !== "in_progress" && a.state !== "submitted") continue;
    countedByTest.set(a.test_id, (countedByTest.get(a.test_id) ?? 0) + 1);
    const prev = attemptByTest.get(a.test_id);
    if (!prev) {
      attemptByTest.set(a.test_id, a);
    } else if (a.state === "in_progress" && prev.state !== "in_progress") {
      attemptByTest.set(a.test_id, a);
    }
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
      maxAttempts: t.max_attempts ?? 1,
      countedAttempts: countedByTest.get(t.id) ?? 0,
      expiresAtMs: attempt?.expires_at
        ? new Date(attempt.expires_at).getTime()
        : null,
      subscriptionOverlappedWindow,
      grantOverlappedWindow,
    });
  });
}

/**
 * Per-test attempt summary shared by every student test list (Tests page,
 * professional-session slot page). Invalidated rows must not be passed in.
 * - counted: in_progress + submitted attempts (the max_attempts count).
 * - display: a live in_progress attempt wins; otherwise the ranked (best
 *   submitted) attempt — highest score, earliest submit on ties.
 */
export function summarizeAttemptsByTest<
  T extends {
    test_id: string;
    state: string;
    score?: number | null;
    submitted_at?: string | null;
  },
>(attempts: readonly T[]): {
  displayByTest: Map<string, T>;
  countedByTest: Map<string, number>;
} {
  const displayByTest = new Map<string, T>();
  const countedByTest = new Map<string, number>();
  for (const a of attempts) {
    if (a.state !== "in_progress" && a.state !== "submitted") continue;
    countedByTest.set(a.test_id, (countedByTest.get(a.test_id) ?? 0) + 1);
    const prev = displayByTest.get(a.test_id);
    if (!prev) {
      displayByTest.set(a.test_id, a);
    } else if (prev.state === "in_progress") {
      continue;
    } else if (a.state === "in_progress") {
      displayByTest.set(a.test_id, a);
    } else {
      const aScore = Number(a.score ?? -Infinity);
      const pScore = Number(prev.score ?? -Infinity);
      if (
        aScore > pScore ||
        (aScore === pScore && (a.submitted_at ?? "") < (prev.submitted_at ?? ""))
      ) {
        displayByTest.set(a.test_id, a);
      }
    }
  }
  return { displayByTest, countedByTest };
}

/** "Attempt 2 of 3" while live, "Attempts used: 2 of 3" otherwise; null for single-attempt tests. */
export function attemptUsageLabel(
  state: StudentTestListState,
  counted: number,
  maxAttempts: number | null | undefined
): string | null {
  const max = maxAttempts ?? 1;
  if (max <= 1) return null;
  return state === "in_progress"
    ? `Attempt ${counted} of ${max}`
    : `Attempts used: ${counted} of ${max}`;
}

/** Retake link convention: ?attempt=N is the next counted-attempt number (start_attempt p_attempt_no). */
export function retakeHref(testId: string, counted: number): string {
  return `/tests/${testId}/attempt?attempt=${counted + 1}`;
}
