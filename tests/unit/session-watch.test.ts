import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_WATCH_POLL_MS,
  shouldKickForReplacedSession,
} from "../../src/lib/auth/session-watch.ts";

describe("session-watch kick predicate", () => {
  it("uses a finite poll interval (UX, not a security bound)", () => {
    assert.ok(SESSION_WATCH_POLL_MS >= 5_000);
    assert.ok(SESSION_WATCH_POLL_MS <= 60_000);
  });

  it("does not kick when session ids match", () => {
    assert.equal(
      shouldKickForReplacedSession({
        mySessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        activeSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      false
    );
  });

  it("kicks when active_session_id was replaced", () => {
    assert.equal(
      shouldKickForReplacedSession({
        mySessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        activeSessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      true
    );
  });

  it("does not treat a cleared active_session_id as a replacement kick", () => {
    assert.equal(
      shouldKickForReplacedSession({
        mySessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        activeSessionId: null,
      }),
      false
    );
  });

  it("does not kick before the client knows its own session id", () => {
    assert.equal(
      shouldKickForReplacedSession({
        mySessionId: null,
        activeSessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      false
    );
  });
});
