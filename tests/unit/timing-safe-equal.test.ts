import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  timingSafeEqualBearer,
  timingSafeEqualUtf8,
} from "../../src/lib/security/timing-safe-equal.ts";

describe("timingSafeEqualUtf8 / Bearer (L2)", () => {
  it("matches equal strings and rejects unequal", () => {
    assert.equal(timingSafeEqualUtf8("abc", "abc"), true);
    assert.equal(timingSafeEqualUtf8("abc", "abd"), false);
    assert.equal(timingSafeEqualUtf8("abc", "ab"), false);
  });

  it("compares Bearer tokens without accepting prefixes", () => {
    assert.equal(timingSafeEqualBearer("Bearer s3cret", "s3cret"), true);
    assert.equal(timingSafeEqualBearer("Bearer s3cre", "s3cret"), false);
    assert.equal(timingSafeEqualBearer(null, "s3cret"), false);
    assert.equal(timingSafeEqualBearer(undefined, "s3cret"), false);
    assert.equal(timingSafeEqualBearer("s3cret", "s3cret"), false);
  });
});
