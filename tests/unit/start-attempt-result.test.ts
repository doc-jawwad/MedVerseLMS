import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startAttemptMeansAlreadySubmitted } from "../../src/lib/exam/start-attempt-result.ts";

describe("startAttemptMeansAlreadySubmitted", () => {
  it("treats the PostgREST already_submitted error as a result redirect", () => {
    assert.equal(
      startAttemptMeansAlreadySubmitted("already_submitted", null),
      true
    );
  });

  it("treats a committed lazy-finalize payload as a result redirect", () => {
    assert.equal(
      startAttemptMeansAlreadySubmitted(null, {
        already_submitted: true,
        attempt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }),
      true
    );
  });

  it("does not redirect a live resume payload", () => {
    assert.equal(
      startAttemptMeansAlreadySubmitted(null, {
        attempt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        questions: [],
        answers: [],
      }),
      false
    );
  });
});
