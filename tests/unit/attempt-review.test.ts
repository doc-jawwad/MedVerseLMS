import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REVIEW_LOCKED_ENTITLEMENT,
  resultReviewUiState,
  sanitizeAttemptReview,
  type AttemptReviewItem,
  type AttemptReviewPayload,
} from "../../src/lib/tests/attempt-review.ts";

const sampleItem: AttemptReviewItem = {
  idx: 1,
  stem: "Which nerve?",
  options: [{ key: "A", text: "Median" }],
  correct_key: "A",
  explanation: "Because…",
  reference: "ref",
  selected_key: "B",
  voided: false,
  void_policy: null,
};

describe("sanitizeAttemptReview", () => {
  it("keeps items only when allowed", () => {
    const out = sanitizeAttemptReview({
      allowed: true,
      items: [sampleItem],
    });
    assert.equal(out?.allowed, true);
    assert.equal(out?.items?.[0]?.stem, "Which nerve?");
  });

  it("strips items on review_locked_entitlement even if a payload leaked them", () => {
    const leaked: AttemptReviewPayload = {
      allowed: false,
      reason: REVIEW_LOCKED_ENTITLEMENT,
      items: [sampleItem],
    };
    const out = sanitizeAttemptReview(leaked);
    assert.deepEqual(out, {
      allowed: false,
      reason: REVIEW_LOCKED_ENTITLEMENT,
      closes_at: undefined,
    });
    assert.equal("items" in (out ?? {}), false);
  });

  it("maps entitlement lock to UI state with no items", () => {
    const ui = resultReviewUiState({
      allowed: false,
      reason: REVIEW_LOCKED_ENTITLEMENT,
      items: [sampleItem],
    });
    assert.equal(ui.kind, "entitlement_lock");
    assert.equal("items" in ui, false);
  });

  it("normalizes staging get_attempt_review object options so .map works", () => {
    const ui = resultReviewUiState({
      allowed: true,
      items: [
        {
          idx: 1,
          stem: "8J staging validation stem — pick C",
          options: {
            A: "Alpha",
            B: "Bravo",
            C: "Charlie",
            D: "Delta",
          },
          correct_key: "C",
          explanation: "C is correct",
          reference: "",
          selected_key: "C",
          voided: false,
          void_policy: null,
        },
      ],
    });
    assert.equal(ui.kind, "open");
    if (ui.kind !== "open") return;
    const labels = ui.items[0]!.options.map((o) => `${o.key}.${o.text}`);
    assert.deepEqual(labels, ["A.Alpha", "B.Bravo", "C.Charlie", "D.Delta"]);
  });

  it("preserves free-test show_review denials without items", () => {
    assert.equal(
      resultReviewUiState({ allowed: false, reason: "review_disabled" }).kind,
      "disabled"
    );
    assert.equal(
      resultReviewUiState({
        allowed: false,
        reason: "available_after_close",
        closes_at: "2026-09-16T00:00:00Z",
      }).kind,
      "after_close"
    );
  });
});
