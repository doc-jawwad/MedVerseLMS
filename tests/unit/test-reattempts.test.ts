import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attemptPageHasExistingAttempt,
  parseAttemptNo,
} from "../../src/lib/tests/attempt-access-gate.ts";
import { matchStartAttemptError } from "../../src/lib/exam/start-attempt-error.ts";
import {
  REVIEW_AVAILABLE_AFTER_ATTEMPTS,
  resultReviewUiState,
  sanitizeAttemptReview,
} from "../../src/lib/tests/attempt-review.ts";
import { parseOwnTestResult } from "../../src/lib/tests/own-test-result.ts";
import {
  classifyCatalogTestStates,
  getStudentTestListState,
  isIncomingDashboardTest,
  isRetakeAvailable,
  studentTestListLabel,
  studentTestListSection,
  studentTestsPageSection,
  type StudentTestStateInput,
} from "../../src/lib/tests/student-test-state.ts";
import {
  approximateCatalogEligibleCount,
  countStudentTestListStates,
} from "../../src/lib/tests/student-dashboard-presentation.ts";
import { pickTestConfigUpdate } from "../../src/lib/tests/test-config-update.ts";

const opens = Date.parse("2026-01-01T00:00:00Z");
const closes = Date.parse("2026-01-31T00:00:00Z");

function base(o: Partial<StudentTestStateInput> = {}): StudentTestStateInput {
  return {
    nowMs: Date.parse("2026-01-15T12:00:00Z"),
    opensAtMs: opens,
    closesAtMs: closes,
    testStatus: "published",
    entitlement: "free",
    currentlyEntitled: true,
    attemptState: "submitted",
    maxAttempts: 3,
    countedAttempts: 1,
    subscriptionOverlappedWindow: false,
    grantOverlappedWindow: false,
    ...o,
  };
}

describe("list state: Retake available", () => {
  it("shows Retake available when attempts remain, window open, entitled", () => {
    assert.equal(getStudentTestListState(base()), "retake_available");
    assert.equal(studentTestListLabel("retake_available"), "Retake available");
  });

  it("single-attempt tests keep Result (backward compatible)", () => {
    assert.equal(
      getStudentTestListState(base({ maxAttempts: 1, countedAttempts: 1 })),
      "result"
    );
    assert.equal(getStudentTestListState(base({ maxAttempts: undefined })), "result");
  });

  it("attempts exhausted shows Result", () => {
    assert.equal(
      getStudentTestListState(base({ countedAttempts: 3 })),
      "result"
    );
  });

  it("closed or not-yet-open window shows Result, never Retake", () => {
    assert.equal(
      getStudentTestListState(base({ nowMs: closes + 1 })),
      "result"
    );
    assert.equal(
      getStudentTestListState(base({ testStatus: "closed" })),
      "result"
    );
    assert.equal(isRetakeAvailable(base({ nowMs: opens - 1 })), false);
  });

  it("no live entitlement shows Result (paid access unchanged)", () => {
    assert.equal(
      getStudentTestListState(base({ currentlyEntitled: false })),
      "result"
    );
  });

  it("a live in-progress attempt wins over Retake available", () => {
    assert.equal(
      getStudentTestListState(
        base({ attemptState: "in_progress", countedAttempts: 2 })
      ),
      "in_progress"
    );
  });

  it("expired in-progress past the sweep presents as Result, not Retake", () => {
    assert.equal(
      getStudentTestListState(
        base({
          attemptState: "in_progress",
          expiresAtMs: base().nowMs - 120_000,
        })
      ),
      "result"
    );
  });

  it("Available (first attempt) is unchanged", () => {
    assert.equal(
      getStudentTestListState(base({ attemptState: null, countedAttempts: 0 })),
      "available"
    );
  });

  it("retake state sits with Available/incoming sections", () => {
    assert.equal(studentTestListSection("retake_available"), "available");
    assert.equal(studentTestsPageSection("retake_available"), "available");
    assert.equal(isIncomingDashboardTest("retake_available"), true);
  });
});

describe("classifyCatalogTestStates with several attempts per test", () => {
  const test = {
    id: "t1",
    status: "published",
    opens_at: "2026-01-01T00:00:00Z",
    closes_at: "2026-01-31T00:00:00Z",
    entitlement: "free",
    max_attempts: 3,
  };
  const common = {
    nowMs: Date.parse("2026-01-15T12:00:00Z"),
    accessibleIds: ["t1"],
    subscriptions: [],
    grants: [],
  };

  it("submitted only -> retake_available", () => {
    const [s] = classifyCatalogTestStates({
      ...common,
      tests: [test],
      attempts: [{ test_id: "t1", state: "submitted" }],
    });
    assert.equal(s, "retake_available");
  });

  it("submitted + live in_progress -> in_progress regardless of row order", () => {
    for (const attempts of [
      [
        { test_id: "t1", state: "submitted" },
        { test_id: "t1", state: "in_progress", expires_at: "2026-01-15T13:00:00Z" },
      ],
      [
        { test_id: "t1", state: "in_progress", expires_at: "2026-01-15T13:00:00Z" },
        { test_id: "t1", state: "submitted" },
      ],
    ]) {
      const [s] = classifyCatalogTestStates({ ...common, tests: [test], attempts });
      assert.equal(s, "in_progress");
    }
  });

  it("three submitted attempts of three allowed -> result", () => {
    const [s] = classifyCatalogTestStates({
      ...common,
      tests: [test],
      attempts: [1, 2, 3].map(() => ({ test_id: "t1", state: "submitted" })),
    });
    assert.equal(s, "result");
  });

  it("missing max_attempts behaves as single attempt", () => {
    const [s] = classifyCatalogTestStates({
      ...common,
      tests: [{ ...test, max_attempts: null }],
      attempts: [{ test_id: "t1", state: "submitted" }],
    });
    assert.equal(s, "result");
  });
});

describe("dashboard counts", () => {
  it("counts retake_available and treats it as eligible", () => {
    const counts = countStudentTestListStates([
      "retake_available",
      "result",
      "not_eligible",
    ]);
    assert.equal(counts.retake_available, 1);
    assert.equal(approximateCatalogEligibleCount(counts), 2);
  });
});

describe("start_attempt error contract", () => {
  it("maps the new multi-attempt codes", () => {
    assert.equal(matchStartAttemptError("attempt_limit_reached"), "attempt_limit_reached");
    assert.equal(matchStartAttemptError("attempt_no_mismatch"), "attempt_no_mismatch");
  });

  it("existing codes are unchanged", () => {
    assert.equal(matchStartAttemptError("already_submitted"), "already_submitted");
    assert.equal(
      matchStartAttemptError("attempt_locked_other_device"),
      "attempt_locked_other_device"
    );
    assert.equal(matchStartAttemptError("test_window_closed"), "test_window_closed");
  });
});

describe("attempt page retake intent", () => {
  it("parses ?attempt=N strictly", () => {
    assert.equal(parseAttemptNo("2"), 2);
    assert.equal(parseAttemptNo(["3", "9"]), 3);
    for (const bad of [undefined, null, "", "0", "-1", "1.5", "abc", "02", "99999999"]) {
      assert.equal(parseAttemptNo(bad as string | undefined), null);
    }
  });

  it("live gate: resume always skips; submitted history skips only legacy links", () => {
    assert.equal(
      attemptPageHasExistingAttempt([{ state: "in_progress" }, { state: "submitted" }], 2),
      true
    );
    assert.equal(attemptPageHasExistingAttempt([{ state: "submitted" }], null), true);
    // Explicit retake of a paid test must still pass the live-access gate.
    assert.equal(attemptPageHasExistingAttempt([{ state: "submitted" }], 2), false);
    assert.equal(attemptPageHasExistingAttempt([], null), false);
  });
});

describe("review hold UI state", () => {
  const leaked = {
    allowed: false,
    reason: REVIEW_AVAILABLE_AFTER_ATTEMPTS,
    attempts_used: 1,
    max_attempts: 3,
    items: [
      {
        idx: 1,
        stem: "secret stem",
        options: [],
        correct_key: "A",
        explanation: "secret",
        reference: "",
        selected_key: null,
        voided: false,
        void_policy: null,
      },
    ],
  };

  it("maps available_after_attempts and never carries items", () => {
    const ui = resultReviewUiState(leaked);
    assert.deepEqual(ui, { kind: "after_attempts", attemptsUsed: 1, maxAttempts: 3 });
    assert.equal(JSON.stringify(ui).includes("secret"), false);
    assert.equal("items" in (sanitizeAttemptReview(leaked) ?? {}), false);
  });
});

describe("own result parsing with attempt history", () => {
  const raw = {
    test: {
      id: "11111111-1111-1111-1111-111111111111",
      title: "T",
      closes_at: "2026-01-02T00:00:00Z",
      show_review: "after_submit",
      negative_mark: 0,
      max_attempts: 3,
    },
    attempt: {
      id: "22222222-2222-2222-2222-222222222222",
      state: "submitted",
      score: 3,
      max_score: 3,
      percentage: 100,
    },
    invalidated: [],
    attempts_used: 2,
    has_in_progress: false,
    attempts: [
      { id: "a", attempt_no: 1, state: "submitted", score: 1, is_ranked: false },
      { id: "b", attempt_no: 2, state: "submitted", score: 3, is_ranked: true },
      { id: "c", attempt_no: 3, state: "invalidated", score: 2, is_ranked: false },
      { id: "d", attempt_no: 4, state: "bogus" },
    ],
  };

  it("keeps history rows, drops malformed ones", () => {
    const out = parseOwnTestResult(raw);
    assert.equal(out?.test.max_attempts, 3);
    assert.equal(out?.attempts_used, 2);
    assert.deepEqual(
      out?.attempts.map((a) => [a.attempt_no, a.state, a.is_ranked]),
      [
        [1, "submitted", false],
        [2, "submitted", true],
        [3, "invalidated", false],
      ]
    );
  });

  it("defaults to single-attempt when the RPC predates max_attempts", () => {
    const legacy = { ...raw, test: { ...raw.test, max_attempts: undefined }, attempts: undefined };
    const out = parseOwnTestResult(legacy);
    assert.equal(out?.test.max_attempts, 1);
    assert.deepEqual(out?.attempts, []);
  });
});

describe("test config", () => {
  it("max_attempts is an allowlisted config field", () => {
    assert.deepEqual(pickTestConfigUpdate({ max_attempts: 4 }), { max_attempts: 4 });
  });
});
