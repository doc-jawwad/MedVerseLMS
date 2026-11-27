import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  publishTestErrorMessage,
  testIntegrityErrorMessage,
} from "../../src/lib/tests/publish-test-errors.ts";

describe("publishTestErrorMessage", () => {
  it("preserves validation failed checklist language", () => {
    assert.equal(
      publishTestErrorMessage("validation failed: question count >= 1"),
      "This test has no questions. Add at least one question before publishing."
    );
    assert.equal(
      publishTestErrorMessage("validation failed: no soft-deleted questions"),
      "validation failed: no soft-deleted questions"
    );
    assert.equal(
      publishTestErrorMessage("validation failed: question versions freeze"),
      "validation failed: question versions freeze"
    );
  });

  it("maps permission and draft-state codes", () => {
    assert.equal(
      publishTestErrorMessage("permission_denied"),
      "You do not have permission to publish tests."
    );
    assert.equal(
      publishTestErrorMessage("only draft tests can be published"),
      "Only draft tests can be published."
    );
  });

  it("explains wrong-year questions without exposing internals", () => {
    assert.equal(
      publishTestErrorMessage("test_question_year_mismatch"),
      "Some questions belong to another class/year. Remove or replace them in the draft before publishing."
    );
  });

  it("falls back safely for internals", () => {
    assert.equal(
      publishTestErrorMessage(
        'duplicate key value violates unique constraint "x"'
      ),
      "Something went wrong. Please try again."
    );
    assert.equal(
      publishTestErrorMessage(""),
      "Something went wrong. Please try again."
    );
  });

  it("maps a serialization abort to a retry message (#38)", () => {
    assert.equal(
      publishTestErrorMessage("deadlock detected"),
      "Another change to this test was in progress — please retry."
    );
  });
});

describe("testIntegrityErrorMessage (#38)", () => {
  it("explains a blocked year change on question edit/move or test config", () => {
    assert.equal(
      testIntegrityErrorMessage("test_question_year_mismatch"),
      "This change would put a question and its test in different classes/years. Remove the question from the affected draft test(s) first."
    );
  });

  it("maps deadlock aborts to retry copy", () => {
    assert.equal(
      testIntegrityErrorMessage("deadlock detected"),
      "Another change to this test was in progress — please retry."
    );
  });

  it("returns null for anything else so callers keep generic handling", () => {
    assert.equal(testIntegrityErrorMessage("permission_denied"), null);
    assert.equal(testIntegrityErrorMessage(""), null);
    assert.equal(testIntegrityErrorMessage(undefined), null);
  });
});
