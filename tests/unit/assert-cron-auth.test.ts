import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertCronAuthorized } from "../../src/lib/cron/assert-cron-auth.ts";

describe("assertCronAuthorized (M7)", () => {
  it("denies when CRON_SECRET is missing", () => {
    const result = assertCronAuthorized("Bearer anything", undefined);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.error, "cron_secret_unconfigured");
    }
  });

  it("denies when CRON_SECRET is empty", () => {
    const result = assertCronAuthorized("Bearer ", "");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.error, "cron_secret_unconfigured");
    }
  });

  it("denies wrong secret", () => {
    const result = assertCronAuthorized("Bearer wrong", "correct-secret");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
      assert.equal(result.error, "unauthorized");
    }
  });

  it("denies missing Authorization header", () => {
    const result = assertCronAuthorized(null, "correct-secret");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
      assert.equal(result.error, "unauthorized");
    }
  });

  it("accepts valid Bearer secret", () => {
    const result = assertCronAuthorized(
      "Bearer correct-secret",
      "correct-secret"
    );
    assert.equal(result.ok, true);
  });

  it("does not echo secret in error payloads", () => {
    const result = assertCronAuthorized("Bearer leaked", "super-secret-value");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.includes("super-secret"), false);
      assert.equal(JSON.stringify(result).includes("super-secret"), false);
    }
  });
});
