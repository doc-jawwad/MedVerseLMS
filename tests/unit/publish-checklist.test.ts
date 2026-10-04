import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  presentPublishChecklistItem,
  publishChecklistBlockReason,
} from "../../src/lib/tests/publish-checklist.ts";
import { publishTestErrorMessage } from "../../src/lib/tests/publish-test-errors.ts";

describe("presentPublishChecklistItem", () => {
  it("makes zero-question failure readable and actionable", () => {
    const presented = presentPublishChecklistItem({
      check: "question count >= 1",
      pass: false,
      detail: "0 questions",
    });
    assert.equal(presented.title, "At least one question required");
    assert.match(presented.detail, /0 questions/i);
    assert.match(presented.hint ?? "", /add at least one question/i);
  });

  it("keeps a passing question-count row clear without a failure hint", () => {
    const presented = presentPublishChecklistItem({
      check: "question count >= 1",
      pass: true,
      detail: "1 questions",
    });
    assert.equal(presented.title, "Question count");
    assert.equal(presented.detail, "1 questions");
    assert.equal(presented.hint, null);
  });

  it("leaves unrelated checklist rows unchanged", () => {
    const presented = presentPublishChecklistItem({
      check: "all questions approved",
      pass: false,
      detail: "2 not approved",
    });
    assert.equal(presented.title, "all questions approved");
    assert.equal(presented.detail, "2 not approved");
    assert.equal(presented.hint, null);
  });
});

describe("publishChecklistBlockReason", () => {
  it("blocks publish with an explicit zero-question reason", () => {
    const reason = publishChecklistBlockReason([
      { check: "question count >= 1", pass: false, detail: "0 questions" },
      { check: "valid schedule", pass: true, detail: "ok" },
    ]);
    assert.match(reason ?? "", /at least one question/i);
  });

  it("returns null when every checklist item passes", () => {
    assert.equal(
      publishChecklistBlockReason([
        { check: "question count >= 1", pass: true, detail: "3 questions" },
        { check: "valid schedule", pass: true, detail: "ok" },
      ]),
      null
    );
  });
});

describe("publishTestErrorMessage question-count", () => {
  it("maps validation failed question-count to actionable copy", () => {
    assert.equal(
      publishTestErrorMessage("validation failed: question count >= 1"),
      "This test has no questions. Add at least one question before publishing."
    );
  });

  it("preserves other validation failed checklist language", () => {
    assert.equal(
      publishTestErrorMessage("validation failed: no soft-deleted questions"),
      "validation failed: no soft-deleted questions"
    );
  });
});
