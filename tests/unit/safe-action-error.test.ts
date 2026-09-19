import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSafeBusinessErrorCode,
  sanitizeClientErrorMessage,
} from "../../src/lib/errors/client-safe-error.ts";

describe("isSafeBusinessErrorCode", () => {
  it("accepts snake_case RPC tokens", () => {
    assert.equal(isSafeBusinessErrorCode("permission_denied"), true);
    assert.equal(isSafeBusinessErrorCode("application_not_found"), true);
    assert.equal(isSafeBusinessErrorCode("invalid_screenshot_object_key"), true);
  });

  it("rejects SQL/internal leakage", () => {
    assert.equal(
      isSafeBusinessErrorCode(
        'duplicate key value violates unique constraint "subscriptions_one_active"'
      ),
      false
    );
    assert.equal(
      isSafeBusinessErrorCode(
        'new row violates row-level security policy for table "profiles"'
      ),
      false
    );
    assert.equal(isSafeBusinessErrorCode("permission denied for table audit_logs"), false);
  });
});

describe("sanitizeClientErrorMessage", () => {
  it("passes through safe business codes", () => {
    assert.equal(
      sanitizeClientErrorMessage("permission_denied"),
      "permission_denied"
    );
  });

  it("genericizes Auth/DB text", () => {
    assert.equal(
      sanitizeClientErrorMessage(
        "Signup requires a valid password",
        "Could not create your account. Please try again."
      ),
      "Could not create your account. Please try again."
    );
    assert.equal(
      sanitizeClientErrorMessage(
        'duplicate key value violates unique constraint "x"'
      ),
      "Something went wrong. Please try again."
    );
  });
});
