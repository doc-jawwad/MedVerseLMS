import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOtherDeviceLockMessage,
  isSessionSupersededMessage,
  matchStartAttemptError,
} from "../../src/lib/exam/start-attempt-error.ts";

describe("matchStartAttemptError", () => {
  it("prefers already_submitted over session_superseded", () => {
    assert.equal(
      matchStartAttemptError("already_submitted; session_superseded"),
      "already_submitted"
    );
  });

  it("maps a genuine other-device lock", () => {
    assert.equal(
      matchStartAttemptError("attempt_locked_other_device"),
      "attempt_locked_other_device"
    );
    assert.equal(isOtherDeviceLockMessage("attempt_locked_other_device"), true);
  });

  it("maps a genuine session kick only for that code", () => {
    assert.equal(matchStartAttemptError("session_superseded"), "session_superseded");
    assert.equal(isSessionSupersededMessage("session_superseded"), true);
    assert.equal(isSessionSupersededMessage("test_window_closed"), false);
    assert.equal(isSessionSupersededMessage("already_submitted"), false);
  });

  it("does not treat a closed/stale path as a kick", () => {
    assert.equal(matchStartAttemptError("test_window_closed"), "test_window_closed");
    assert.equal(isOtherDeviceLockMessage("test_window_closed"), false);
    assert.equal(isSessionSupersededMessage("already_submitted"), false);
  });
});
