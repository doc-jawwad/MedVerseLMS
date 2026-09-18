import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOwnTestResult } from "../../src/lib/tests/own-test-result.ts";

const sample = {
  test: {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Year 2 Anatomy",
    closes_at: "2026-01-02T00:00:00Z",
    show_review: "after_submit",
    negative_mark: 0.25,
  },
  attempt: {
    id: "22222222-2222-2222-2222-222222222222",
    state: "submitted",
    score: 8,
    max_score: 10,
    raw_correct: 8,
    raw_wrong: 2,
    raw_blank: 0,
    percentage: 80,
    rank: 3,
    percentile: 50,
    submitted_at: "2026-01-01T00:00:00Z",
    submit_source: "student",
  },
  invalidated: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      invalidated_reason: "device failure",
    },
  ],
};

describe("parseOwnTestResult", () => {
  it("loads owned submitted summary fields", () => {
    const out = parseOwnTestResult(sample);
    assert.equal(out?.test.title, "Year 2 Anatomy");
    assert.equal(out?.attempt.score, 8);
    assert.equal(out?.attempt.percentage, 80);
    assert.equal(out?.attempt.rank, 3);
    assert.equal(out?.invalidated.length, 1);
  });

  it("returns null when the student has no submitted attempt", () => {
    assert.equal(parseOwnTestResult(null), null);
    assert.equal(parseOwnTestResult(undefined), null);
    assert.equal(parseOwnTestResult({}), null);
    assert.equal(
      parseOwnTestResult({
        ...sample,
        attempt: { ...sample.attempt, state: "in_progress" },
      }),
      null
    );
  });

  it("does not treat another student's payload as owned when ids are missing", () => {
    assert.equal(
      parseOwnTestResult({
        test: { title: "Secret" },
        attempt: { state: "submitted", score: 99 },
      }),
      null
    );
  });

  it("does not copy protected review fields onto the summary", () => {
    const leaked = {
      ...sample,
      items: [{ stem: "leak", correct_key: "A", selected_key: "B" }],
      stem: "leak",
      correct_key: "A",
      explanation: "nope",
    };
    const out = parseOwnTestResult(leaked);
    assert.equal(out?.test.title, "Year 2 Anatomy");
    assert.equal("items" in (out ?? {}), false);
    assert.equal("stem" in (out ?? {}), false);
    assert.equal("correct_key" in (out ?? {}), false);
    assert.equal("explanation" in (out ?? {}), false);
  });
});
