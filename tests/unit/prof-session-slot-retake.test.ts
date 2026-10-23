import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  attemptUsageLabel,
  classifyCatalogTestStates,
  retakeHref,
  summarizeAttemptsByTest,
} from "../../src/lib/tests/student-test-state.ts";

const NOW = Date.parse("2026-01-15T12:00:00Z");
const openTest = {
  id: "t1",
  status: "published",
  opens_at: "2026-01-01T00:00:00Z",
  closes_at: "2026-01-31T00:00:00Z",
  entitlement: "free",
  max_attempts: 3,
};
const common = {
  nowMs: NOW,
  accessibleIds: ["t1"],
  subscriptions: [],
  grants: [],
};

type A = {
  test_id: string;
  state: string;
  score?: number | null;
  submitted_at?: string | null;
  expires_at?: string | null;
};

/** What the slot page does: same helper + classifier as the Tests page. */
function slot(test: typeof openTest, attempts: A[], accessible = ["t1"]) {
  const { displayByTest, countedByTest } = summarizeAttemptsByTest(attempts);
  const [state] = classifyCatalogTestStates({
    ...common,
    accessibleIds: accessible,
    tests: [test],
    attempts,
  });
  return {
    state: state!,
    display: displayByTest.get(test.id) ?? null,
    counted: countedByTest.get(test.id) ?? 0,
  };
}

describe("slot page: retake visibility", () => {
  it("offers Retake available with usage and ?attempt=N link", () => {
    const r = slot(openTest, [
      { test_id: "t1", state: "submitted", score: 2, submitted_at: "2026-01-10T00:00:00Z" },
    ]);
    assert.equal(r.state, "retake_available");
    assert.equal(r.counted, 1);
    assert.equal(attemptUsageLabel(r.state, r.counted, 3), "Attempts used: 1 of 3");
    assert.equal(retakeHref("t1", r.counted), "/tests/t1/attempt?attempt=2");
  });

  it("single-attempt tests show no usage line and no retake", () => {
    const r = slot({ ...openTest, max_attempts: 1 }, [
      { test_id: "t1", state: "submitted", score: 2 },
    ]);
    assert.equal(r.state, "result");
    assert.equal(attemptUsageLabel(r.state, r.counted, 1), null);
  });

  it("a test missing max_attempts (old row shape) behaves as single-attempt", () => {
    const { max_attempts: _drop, ...noMax } = openTest;
    void _drop;
    const [state] = classifyCatalogTestStates({
      ...common,
      tests: [noMax],
      attempts: [{ test_id: "t1", state: "submitted" }],
    });
    assert.equal(state, "result");
  });

  it("not entitled now -> no retake (paid access is not bypassed by the UI)", () => {
    const r = slot(openTest, [{ test_id: "t1", state: "submitted", score: 2 }], []);
    assert.equal(r.state, "result");
  });
});

describe("slot page: live attempt priority", () => {
  const live = {
    test_id: "t1",
    state: "in_progress",
    score: null,
    expires_at: "2026-01-15T13:00:00Z",
  };
  const done = { test_id: "t1", state: "submitted", score: 3, submitted_at: "2026-01-10T00:00:00Z" };

  it("in_progress wins for display and state, regardless of row order", () => {
    for (const rows of [[done, live], [live, done]]) {
      const r = slot(openTest, rows);
      assert.equal(r.state, "in_progress");
      assert.equal(r.display?.state, "in_progress");
      assert.equal(r.counted, 2);
      assert.equal(attemptUsageLabel(r.state, r.counted, 3), "Attempt 2 of 3");
    }
  });

  it("with no live attempt the best submitted attempt is displayed; earliest wins ties", () => {
    const r = slot(openTest, [
      { test_id: "t1", state: "submitted", score: 1, submitted_at: "2026-01-09T00:00:00Z" },
      { test_id: "t1", state: "submitted", score: 3, submitted_at: "2026-01-12T00:00:00Z" },
      { test_id: "t1", state: "submitted", score: 3, submitted_at: "2026-01-11T00:00:00Z" },
    ]);
    assert.equal(r.display?.submitted_at, "2026-01-11T00:00:00Z");
    assert.equal(r.state, "result"); // 3 of 3 used
  });

  it("invalidated rows are ignored by the summary", () => {
    const { countedByTest, displayByTest } = summarizeAttemptsByTest([
      { test_id: "t1", state: "invalidated", score: 99 },
      { test_id: "t1", state: "submitted", score: 1 },
    ]);
    assert.equal(countedByTest.get("t1"), 1);
    assert.equal(displayByTest.get("t1")?.score, 1);
  });
});

describe("slot page: exhausted and closed", () => {
  it("exhausted attempts -> Result, no retake", () => {
    const rows = [1, 2, 3].map((n) => ({ test_id: "t1", state: "submitted", score: n }));
    assert.equal(slot(openTest, rows).state, "result");
  });

  it("closed window / closed status -> Result, no retake", () => {
    const rows = [{ test_id: "t1", state: "submitted", score: 1 }];
    const [late] = classifyCatalogTestStates({
      ...common,
      nowMs: Date.parse("2026-02-01T00:00:00Z"),
      tests: [openTest],
      attempts: rows,
    });
    assert.equal(late, "result");
    const [closed] = classifyCatalogTestStates({
      ...common,
      tests: [{ ...openTest, status: "closed" }],
      attempts: rows,
    });
    assert.equal(closed, "result");
  });
});

describe("slot page source contract", () => {
  const src = readFileSync("src/components/academic/prof-session-slot-page.tsx", "utf8");

  it("selects max_attempts and submitted_at", () => {
    assert.match(src, /entitlement, max_attempts, subjects\(name\)/);
    assert.match(src, /percentage, submitted_at/);
  });

  it("reuses the shared attempt rules instead of its own map", () => {
    assert.match(src, /summarizeAttemptsByTest/);
    assert.match(src, /retakeHref/);
    assert.match(src, /attemptUsageLabel/);
    assert.doesNotMatch(src, /a\.state === "submitted"\) attemptByTest\.set/);
  });

  it("retake link is gated on retake state AND current entitlement (UX only)", () => {
    assert.match(src, /state === "retake_available" && isEntitled/);
  });
});
