import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getStudentTestListState,
  grantOverlapsTestWindow,
  hadHistoricalAccessEvidence,
  studentTestListLabel,
  studentTestListSection,
  subscriptionOverlapsTestWindow,
  type StudentTestStateInput,
} from "../../src/lib/tests/student-test-state.ts";

const opens = Date.parse("2026-01-01T00:00:00Z");
const closes = Date.parse("2026-01-31T00:00:00Z");

function base(
  overrides: Partial<StudentTestStateInput> = {}
): StudentTestStateInput {
  return {
    nowMs: Date.parse("2026-01-15T12:00:00Z"),
    opensAtMs: opens,
    closesAtMs: closes,
    testStatus: "published",
    entitlement: "any_subscription",
    currentlyEntitled: true,
    attemptState: null,
    subscriptionOverlappedWindow: false,
    grantOverlappedWindow: false,
    ...overrides,
  };
}

describe("getStudentTestListState — attempt priority", () => {
  it("in_progress → In Progress (even if closed)", () => {
    assert.equal(
      getStudentTestListState(
        base({
          attemptState: "in_progress",
          nowMs: Date.parse("2026-02-01T00:00:00Z"),
          testStatus: "closed",
          currentlyEntitled: false,
        })
      ),
      "in_progress"
    );
  });

  it("submitted → Result (overrides closed/not entitled)", () => {
    assert.equal(
      getStudentTestListState(
        base({
          attemptState: "submitted",
          nowMs: Date.parse("2026-04-01T00:00:00Z"),
          currentlyEntitled: true,
          subscriptionOverlappedWindow: false,
        })
      ),
      "result"
    );
  });
});

describe("getStudentTestListState — open window", () => {
  it("open + entitled → Available", () => {
    assert.equal(getStudentTestListState(base()), "available");
  });

  it("open + not entitled → Locked", () => {
    assert.equal(
      getStudentTestListState(base({ currentlyEntitled: false })),
      "locked"
    );
  });

  it("before opens → Upcoming", () => {
    assert.equal(
      getStudentTestListState(
        base({ nowMs: Date.parse("2025-12-15T00:00:00Z") })
      ),
      "upcoming"
    );
  });
});

describe("getStudentTestListState — closed heuristic", () => {
  const closedNow = Date.parse("2026-04-01T00:00:00Z");

  it("closed + free entitlement → Missed (no fake attempt)", () => {
    assert.equal(
      getStudentTestListState(
        base({
          nowMs: closedNow,
          testStatus: "closed",
          entitlement: "free",
          currentlyEntitled: true,
          attemptState: null,
        })
      ),
      "missed"
    );
  });

  it("closed + subscription overlapped window → Missed", () => {
    assert.equal(
      getStudentTestListState(
        base({
          nowMs: closedNow,
          testStatus: "closed",
          currentlyEntitled: false,
          subscriptionOverlappedWindow: true,
        })
      ),
      "missed"
    );
  });

  it("closed + grant overlapped window → Missed", () => {
    assert.equal(
      getStudentTestListState(
        base({
          nowMs: closedNow,
          testStatus: "closed",
          currentlyEntitled: false,
          grantOverlappedWindow: true,
        })
      ),
      "missed"
    );
  });

  it("closed + no eligibility evidence → Not eligible", () => {
    assert.equal(
      getStudentTestListState(
        base({
          nowMs: closedNow,
          testStatus: "closed",
          currentlyEntitled: false,
          subscriptionOverlappedWindow: false,
          grantOverlappedWindow: false,
          entitlement: "any_subscription",
        })
      ),
      "not_eligible"
    );
  });

  it("late subscriber (Ahmad): current entitlement does not rewrite history", () => {
    // Subscribed in April; January test closed; no overlap evidence.
    assert.equal(
      getStudentTestListState(
        base({
          nowMs: closedNow,
          testStatus: "closed",
          entitlement: "any_subscription",
          currentlyEntitled: true,
          subscriptionOverlappedWindow: false,
          grantOverlappedWindow: false,
          attemptState: null,
        })
      ),
      "not_eligible"
    );
  });

  it("Not eligible is never Missed without evidence", () => {
    const state = getStudentTestListState(
      base({
        nowMs: closedNow,
        testStatus: "closed",
        currentlyEntitled: false,
      })
    );
    assert.equal(state, "not_eligible");
    assert.notEqual(state, "missed");
  });
});

describe("overlap helpers", () => {
  it("subscription overlap matches window", () => {
    assert.equal(
      subscriptionOverlapsTestWindow(
        Date.parse("2026-01-10T00:00:00Z"),
        Date.parse("2026-02-10T00:00:00Z"),
        opens,
        closes
      ),
      true
    );
    assert.equal(
      subscriptionOverlapsTestWindow(
        Date.parse("2026-04-01T00:00:00Z"),
        Date.parse("2026-05-01T00:00:00Z"),
        opens,
        closes
      ),
      false
    );
  });

  it("grant overlap uses created/revoked bounds", () => {
    assert.equal(
      grantOverlapsTestWindow(
        Date.parse("2025-12-01T00:00:00Z"),
        null,
        opens,
        closes
      ),
      true
    );
    assert.equal(
      grantOverlapsTestWindow(
        Date.parse("2025-12-01T00:00:00Z"),
        Date.parse("2025-12-15T00:00:00Z"),
        opens,
        closes
      ),
      false
    );
  });

  it("hadHistoricalAccessEvidence requires free or overlap", () => {
    assert.equal(
      hadHistoricalAccessEvidence({
        entitlement: "free",
        subscriptionOverlappedWindow: false,
        grantOverlappedWindow: false,
      }),
      true
    );
    assert.equal(
      hadHistoricalAccessEvidence({
        entitlement: "plan",
        subscriptionOverlappedWindow: false,
        grantOverlappedWindow: false,
      }),
      false
    );
  });
});

describe("labels and sections", () => {
  it("labels match product terminology", () => {
    assert.equal(studentTestListLabel("not_eligible"), "Not eligible");
    assert.equal(studentTestListLabel("missed"), "Missed");
    assert.equal(studentTestListLabel("in_progress"), "In progress");
    assert.equal(studentTestListLabel("result"), "Result");
  });

  it("sections place states correctly", () => {
    assert.equal(studentTestListSection("available"), "available");
    assert.equal(studentTestListSection("locked"), "available");
    assert.equal(studentTestListSection("in_progress"), "available");
    assert.equal(studentTestListSection("upcoming"), "upcoming");
    assert.equal(studentTestListSection("missed"), "previous");
    assert.equal(studentTestListSection("not_eligible"), "previous");
    assert.equal(studentTestListSection("result"), "previous");
  });
});
