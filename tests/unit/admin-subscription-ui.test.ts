import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminSubscriptionErrorMessage,
  buildAdminSubPermissions,
} from "../../src/lib/subscriptions/admin-errors.ts";

describe("admin subscription error mapping", () => {
  it("maps permission and review codes", () => {
    assert.match(
      adminSubscriptionErrorMessage("permission_denied"),
      /permission/i
    );
    assert.match(
      adminSubscriptionErrorMessage("application_not_pending"),
      /pending/i
    );
    assert.match(
      adminSubscriptionErrorMessage("screenshot_access_denied"),
      /screenshot/i
    );
    assert.equal(
      adminSubscriptionErrorMessage("relation does not exist"),
      "Something went wrong. Please try again."
    );
  });
});

describe("admin subscription permission matrix", () => {
  it("requires both review and manage for approve", () => {
    assert.equal(
      buildAdminSubPermissions({
        manageSubscriptions: true,
        reviewApplications: true,
        managePaymentSettings: false,
      }).canApprove,
      true
    );
    assert.equal(
      buildAdminSubPermissions({
        manageSubscriptions: true,
        reviewApplications: false,
        managePaymentSettings: true,
      }).canApprove,
      false
    );
    assert.equal(
      buildAdminSubPermissions({
        manageSubscriptions: false,
        reviewApplications: true,
        managePaymentSettings: true,
      }).canApprove,
      false
    );
  });
});
