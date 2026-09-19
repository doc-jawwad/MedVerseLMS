import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attemptPageUsesLiveAccessGate } from "../../src/lib/tests/attempt-access-gate.ts";

describe("attemptPageUsesLiveAccessGate", () => {
  it("skips the live-subscription gate when an attempt already exists", () => {
    assert.equal(attemptPageUsesLiveAccessGate(true), false);
  });

  it("applies the gate only for a new start", () => {
    assert.equal(attemptPageUsesLiveAccessGate(false), true);
  });
});
