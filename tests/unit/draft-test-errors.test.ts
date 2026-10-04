import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftTestErrorMessage } from "../../src/lib/tests/draft-test-errors.ts";

describe("draftTestErrorMessage", () => {
  it("maps known draft-delete codes", () => {
    assert.equal(
      draftTestErrorMessage("test_not_draft"),
      "Only draft tests can be deleted."
    );
    assert.equal(
      draftTestErrorMessage("permission_denied"),
      "You do not have permission to manage tests."
    );
    assert.equal(
      draftTestErrorMessage("test_not_found"),
      "That test was not found."
    );
  });

  it("falls back safely", () => {
    assert.equal(
      draftTestErrorMessage(""),
      "Something went wrong. Please try again."
    );
  });
});
