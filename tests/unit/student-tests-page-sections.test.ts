import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCatalogTestStates,
  studentTestsPageSection,
  type CatalogTestForState,
} from "../../src/lib/tests/student-test-state.ts";

const HOUR = 3_600_000;

describe("student Tests page sections", () => {
  it("places future, open, in-progress, and previous tests in distinct sections", () => {
    const nowMs = Date.parse("2026-10-11T12:00:00.000Z");
    const tests: CatalogTestForState[] = [
      {
        id: "upcoming",
        status: "published",
        opens_at: new Date(nowMs + HOUR).toISOString(),
        closes_at: new Date(nowMs + 3 * HOUR).toISOString(),
        entitlement: "free",
      },
      {
        id: "available",
        status: "published",
        opens_at: new Date(nowMs - HOUR).toISOString(),
        closes_at: new Date(nowMs + HOUR).toISOString(),
        entitlement: "free",
      },
      {
        id: "in_progress",
        status: "published",
        opens_at: new Date(nowMs - HOUR).toISOString(),
        closes_at: new Date(nowMs + HOUR).toISOString(),
        entitlement: "free",
      },
      {
        id: "previous",
        status: "closed",
        opens_at: new Date(nowMs - 5 * HOUR).toISOString(),
        closes_at: new Date(nowMs - HOUR).toISOString(),
        entitlement: "free",
      },
    ];

    const states = classifyCatalogTestStates({
      nowMs,
      tests,
      attempts: [
        {
          test_id: "in_progress",
          state: "in_progress",
          expires_at: new Date(nowMs + HOUR).toISOString(),
        },
        {
          test_id: "previous",
          state: "submitted",
          expires_at: new Date(nowMs - 2 * HOUR).toISOString(),
        },
      ],
      accessibleIds: ["upcoming", "available", "in_progress", "previous"],
      subscriptions: [],
      grants: [],
    });

    assert.deepEqual(
      states.map((state, i) => ({
        id: tests[i]!.id,
        state,
        section: studentTestsPageSection(state),
      })),
      [
        { id: "upcoming", state: "upcoming", section: "upcoming" },
        { id: "available", state: "available", section: "available" },
        { id: "in_progress", state: "in_progress", section: "in_progress" },
        { id: "previous", state: "result", section: "previous" },
      ]
    );
  });

  it("keeps locked open tests in Available without inventing eligibility", () => {
    const nowMs = Date.parse("2026-10-11T12:00:00.000Z");
    const tests: CatalogTestForState[] = [
      {
        id: "locked",
        status: "published",
        opens_at: new Date(nowMs - HOUR).toISOString(),
        closes_at: new Date(nowMs + HOUR).toISOString(),
        entitlement: "any_subscription",
      },
    ];
    const [state] = classifyCatalogTestStates({
      nowMs,
      tests,
      attempts: [],
      accessibleIds: [],
      grants: [],
      subscriptions: [],
    });
    assert.equal(state, "locked");
    assert.equal(studentTestsPageSection(state!), "available");
  });

  it("places submitted results and missed previous tests in Previous", () => {
    const nowMs = Date.parse("2026-10-11T12:00:00.000Z");
    const tests: CatalogTestForState[] = [
      {
        id: "submitted",
        status: "closed",
        opens_at: new Date(nowMs - 5 * HOUR).toISOString(),
        closes_at: new Date(nowMs - HOUR).toISOString(),
        entitlement: "free",
      },
      {
        id: "missed",
        status: "closed",
        opens_at: new Date(nowMs - 5 * HOUR).toISOString(),
        closes_at: new Date(nowMs - HOUR).toISOString(),
        entitlement: "free",
      },
    ];
    const states = classifyCatalogTestStates({
      nowMs,
      tests,
      attempts: [
        {
          test_id: "submitted",
          state: "submitted",
          expires_at: new Date(nowMs - 2 * HOUR).toISOString(),
        },
      ],
      accessibleIds: ["submitted", "missed"],
      subscriptions: [],
      grants: [],
    });
    assert.deepEqual(
      states.map((state, i) => ({
        id: tests[i]!.id,
        state,
        section: studentTestsPageSection(state),
      })),
      [
        { id: "submitted", state: "result", section: "previous" },
        { id: "missed", state: "missed", section: "previous" },
      ]
    );
  });
});
