import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyServerExpiresAt,
  applyServerExpiresAtIso,
  msRemainingFromServerClock,
} from "../../src/lib/exam/timer-deadline.ts";

describe("applyServerExpiresAt", () => {
  const t1700 = Date.parse("2026-09-16T17:00:00.000Z");
  const t1620 = Date.parse("2026-09-16T16:20:00.000Z");
  const t1600 = Date.parse("2026-09-16T16:00:00.000Z");

  it("initializes from server expires_at when no local deadline", () => {
    assert.equal(applyServerExpiresAt(Number.NaN, t1700), t1700);
  });

  it("moves deadline earlier when server sends earlier expires_at", () => {
    assert.equal(applyServerExpiresAt(t1700, t1620), t1620);
  });

  it("rejects later server expires_at (never extend)", () => {
    assert.equal(applyServerExpiresAt(t1620, t1700), t1620);
  });

  it("stays monotonic across repeated earlier updates", () => {
    let d = t1700;
    d = applyServerExpiresAt(d, t1620);
    assert.equal(d, t1620);
    d = applyServerExpiresAt(d, t1600);
    assert.equal(d, t1600);
    d = applyServerExpiresAt(d, t1620);
    assert.equal(d, t1600);
  });

  it("close-now clamp: 17:00 display becomes 16:20", () => {
    const started = Date.parse("2026-09-16T16:00:00.000Z");
    const originalEnd = Date.parse("2026-09-16T17:00:00.000Z");
    const closeNow = Date.parse("2026-09-16T16:20:00.000Z");
    assert.equal(started < originalEnd, true);
    assert.equal(applyServerExpiresAt(originalEnd, closeNow), closeNow);
  });
});

describe("applyServerExpiresAtIso", () => {
  it("resume uses clamped server expires_at", () => {
    const clamped = "2026-09-16T16:20:00.000Z";
    assert.equal(applyServerExpiresAtIso(null, clamped), clamped);
    assert.equal(
      applyServerExpiresAtIso("2026-09-16T17:00:00.000Z", clamped),
      clamped
    );
    assert.equal(
      applyServerExpiresAtIso(clamped, "2026-09-16T17:00:00.000Z"),
      clamped
    );
  });
});

describe("msRemainingFromServerClock", () => {
  it("uses server skew without extending deadline", () => {
    const deadline = Date.parse("2026-09-16T16:20:00.000Z");
    const serverNow = Date.parse("2026-09-16T16:19:00.000Z");
    const clientNow = Date.parse("2026-09-16T16:18:30.000Z");
    const left = msRemainingFromServerClock(deadline, serverNow, clientNow);
    assert.equal(left, 60_000);
  });

  it("reaches zero at server expiry regardless of client drift", () => {
    const deadline = Date.parse("2026-09-16T16:20:00.000Z");
    const serverNow = Date.parse("2026-09-16T16:20:00.000Z");
    const clientNow = Date.parse("2026-09-16T16:25:00.000Z");
    const left = msRemainingFromServerClock(deadline, serverNow, clientNow);
    assert.equal(left, 0);
  });
});
