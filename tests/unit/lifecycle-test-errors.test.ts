import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lifecycleTestErrorMessage } from "../../src/lib/tests/lifecycle-test-errors.ts";

describe("lifecycleTestErrorMessage", () => {
  it("maps return-to-draft and reuse codes", () => {
    assert.equal(
      lifecycleTestErrorMessage("test_has_attempts"),
      "This test already has attempt history and cannot be returned to draft."
    );
    assert.equal(
      lifecycleTestErrorMessage("test_already_open_or_unscheduled"),
      "This test has already opened or has no opening time, so it cannot be returned to draft."
    );
    assert.equal(
      lifecycleTestErrorMessage("test_window_not_closed"),
      "Reuse is available only after the testing window has closed."
    );
    assert.equal(
      lifecycleTestErrorMessage("permission_denied"),
      "You do not have permission to manage tests."
    );
  });

  it("falls back safely for internals", () => {
    assert.equal(
      lifecycleTestErrorMessage('duplicate key value violates unique constraint "x"'),
      "Something went wrong. Please try again."
    );
    assert.equal(
      lifecycleTestErrorMessage(""),
      "Something went wrong. Please try again."
    );
  });
});
