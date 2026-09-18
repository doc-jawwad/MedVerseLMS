import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedAccountStatus } from "../../src/lib/auth/account-status.ts";

describe("isBlockedAccountStatus", () => {
  it("allows only active accounts into the LMS", () => {
    assert.equal(isBlockedAccountStatus("active"), false);
    assert.equal(isBlockedAccountStatus(null), false);
    assert.equal(isBlockedAccountStatus(undefined), false);
  });

  it("blocks restricted, suspended, deactivated, and revoked", () => {
    assert.equal(isBlockedAccountStatus("restricted"), true);
    assert.equal(isBlockedAccountStatus("suspended"), true);
    assert.equal(isBlockedAccountStatus("deactivated"), true);
    assert.equal(isBlockedAccountStatus("revoked"), true);
  });
});
