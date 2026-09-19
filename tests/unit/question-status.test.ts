import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAnswered,
  isRemaining,
  isSkipped,
  nextAnswerState,
  nextRemainingIndex,
  questionStatus,
  skippedQuestionIndexes,
  tallyQuestionStatuses,
} from "../../src/lib/exam/question-status.ts";

const Q1 = "11111111-1111-1111-1111-111111111111";
const Q2 = "22222222-2222-2222-2222-222222222222";
const Q3 = "33333333-3333-3333-3333-333333333333";
const questions = [
  { question_version_id: Q1 },
  { question_version_id: Q2 },
  { question_version_id: Q3 },
];

describe("question status", () => {
  it("treats a selected key as answered, even if marked_for_review is true", () => {
    const answered = { selected_key: "B", marked_for_review: true };
    assert.equal(isAnswered(answered), true);
    assert.equal(isSkipped(answered), false);
    assert.equal(isRemaining(answered), false);
    assert.equal(questionStatus(answered), "answered");
  });

  it("treats marked_for_review with a null key as skipped, not remaining", () => {
    const skipped = { selected_key: null, marked_for_review: true };
    assert.equal(isSkipped(skipped), true);
    assert.equal(isAnswered(skipped), false);
    assert.equal(isRemaining(skipped), false);
    assert.equal(questionStatus(skipped), "skipped");
  });

  it("treats missing or empty rows as remaining", () => {
    assert.equal(questionStatus(undefined), "remaining");
    assert.equal(
      questionStatus({ selected_key: null, marked_for_review: false }),
      "remaining"
    );
  });
});

describe("nextAnswerState", () => {
  it("skip always stores unanswered + marked_for_review", () => {
    const fromAnswered = nextAnswerState(
      { selected_key: "A", marked_for_review: false },
      { type: "skip" }
    );
    assert.deepEqual(fromAnswered, {
      selected_key: null,
      marked_for_review: true,
    });
  });

  it("selecting an option clears skip immediately", () => {
    const next = nextAnswerState(
      { selected_key: null, marked_for_review: true },
      { type: "select", key: "C" }
    );
    assert.deepEqual(next, { selected_key: "C", marked_for_review: false });
    assert.equal(isSkipped(next), false);
    assert.equal(isAnswered(next), true);
  });

  it("clicking the same option again clears to remaining, not skipped", () => {
    const next = nextAnswerState(
      { selected_key: "A", marked_for_review: false },
      { type: "select", key: "A" }
    );
    assert.deepEqual(next, { selected_key: null, marked_for_review: false });
    assert.equal(questionStatus(next), "remaining");
  });

  it("unskip returns remaining unanswered", () => {
    const next = nextAnswerState(
      { selected_key: null, marked_for_review: true },
      { type: "unskip" }
    );
    assert.equal(questionStatus(next), "remaining");
  });
});

describe("tallies and navigation", () => {
  it("separates remaining from skipped", () => {
    const answers = {
      [Q1]: { selected_key: "A", marked_for_review: false },
      [Q2]: { selected_key: null, marked_for_review: true },
    };
    assert.deepEqual(tallyQuestionStatuses(questions, answers), {
      answered: 1,
      skipped: 1,
      remaining: 1,
      total: 3,
    });
    assert.deepEqual(skippedQuestionIndexes(questions, answers), [1]);
  });

  it("next remaining wraps past skipped and answered items", () => {
    const answers = {
      [Q1]: { selected_key: null, marked_for_review: true },
      [Q2]: { selected_key: "B", marked_for_review: false },
    };
    assert.equal(nextRemainingIndex(questions, answers, 0), 2);
    assert.equal(nextRemainingIndex(questions, answers, 2), 2);
  });

  it("returns null when nothing remains", () => {
    const answers = {
      [Q1]: { selected_key: "A", marked_for_review: false },
      [Q2]: { selected_key: null, marked_for_review: true },
      [Q3]: { selected_key: "C", marked_for_review: false },
    };
    assert.equal(nextRemainingIndex(questions, answers, 1), null);
  });
});
