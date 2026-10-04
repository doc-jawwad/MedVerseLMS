import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publishTestErrorMessage } from "../../src/lib/tests/publish-test-errors.ts";

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
});
