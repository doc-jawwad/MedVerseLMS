import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStudentSubscriptionView,
  remainingSubscriptionDays,
  studentCanEditApplication,
  subscriptionExpiryWarningKind,
  subscriptionIsLiveAt,
} from "../../src/lib/subscriptions/student-status.ts";
import { studentSubscriptionErrorMessage } from "../../src/lib/subscriptions/student-errors.ts";
import {
  validatePaymentAmount,
  validatePaymentScreenshotFile,
} from "../../src/lib/payments/application.ts";

const now = new Date("2026-09-15T12:00:00.000Z");

describe("student subscription status view", () => {
  it("shows active plan details and remaining days", () => {
    const view = buildStudentSubscriptionView({
      hasLiveAccess: true,
      now,
      subscriptions: [
        {
          id: "s1",
          status: "active",
          starts_at: "2026-09-01T00:00:00.000Z",
          ends_at: "2026-09-25T00:00:00.000Z",
          plan_name: "MBBS Annual",
        },
      ],
      applications: [],
    });
    assert.equal(view.kind, "active");
    assert.equal(view.hasLiveAccess, true);
    assert.equal(view.active?.plan_name, "MBBS Annual");
    assert.equal(view.remainingDays, 9);
  });

  it("shows pending application and blocks a second create path", () => {
    const view = buildStudentSubscriptionView({
      hasLiveAccess: false,
      now,
      subscriptions: [],
      applications: [
        {
          id: "a1",
          status: "pending",
          amount: 5000,
          currency: "PKR",
          created_at: "2026-09-14T10:00:00.000Z",
          review_note: null,
          reviewed_at: null,
        },
      ],
    });
    assert.equal(view.kind, "pending");
    assert.equal(view.pending?.amount, 5000);
    assert.equal(studentCanEditApplication(view.pending), true);
  });

  it("keeps rejected history and allows a new application", () => {
    const view = buildStudentSubscriptionView({
      hasLiveAccess: false,
      now,
      subscriptions: [],
      applications: [
        {
          id: "a2",
          status: "rejected",
          amount: 1000,
          currency: "PKR",
          created_at: "2026-09-10T10:00:00.000Z",
          review_note: "Unclear screenshot",
          reviewed_at: "2026-09-11T10:00:00.000Z",
        },
      ],
    });
    assert.equal(view.kind, "none");
    assert.equal(view.pending, null);
    assert.equal(view.latestNonPendingApplication?.status, "rejected");
    assert.match(view.description, /rejected/i);
    assert.equal(
      studentCanEditApplication(view.latestNonPendingApplication),
      false
    );
  });

  it("shows expired and deactivated states", () => {
    const expired = buildStudentSubscriptionView({
      hasLiveAccess: false,
      now,
      subscriptions: [
        {
          id: "s2",
          status: "expired",
          starts_at: "2026-01-01T00:00:00.000Z",
          ends_at: "2026-06-01T00:00:00.000Z",
          plan_name: "MBBS Annual",
        },
      ],
      applications: [],
    });
    assert.equal(expired.kind, "expired");

    const deactivated = buildStudentSubscriptionView({
      hasLiveAccess: false,
      now,
      subscriptions: [
        {
          id: "s3",
          status: "deactivated",
          starts_at: "2026-01-01T00:00:00.000Z",
          ends_at: "2026-12-01T00:00:00.000Z",
          plan_name: "MBBS Annual",
        },
      ],
      applications: [],
    });
    assert.equal(deactivated.kind, "deactivated");
  });

  it("treats an active row past ends_at as expired when live access is false", () => {
    const view = buildStudentSubscriptionView({
      hasLiveAccess: false,
      now,
      subscriptions: [
        {
          id: "s4",
          status: "active",
          starts_at: "2026-01-01T00:00:00.000Z",
          ends_at: "2026-09-01T00:00:00.000Z",
          plan_name: "MBBS Annual",
        },
      ],
      applications: [],
    });
    assert.equal(view.kind, "expired");
    assert.equal(remainingSubscriptionDays("2026-09-01T00:00:00.000Z", now), 0);
  });

  it("treats grace_days as still live for display when hasLiveAccess is true", () => {
    const view = buildStudentSubscriptionView({
      hasLiveAccess: true,
      now,
      subscriptions: [
        {
          id: "s5",
          status: "active",
          starts_at: "2026-09-01T00:00:00.000Z",
          ends_at: "2026-09-14T12:00:00.000Z",
          grace_days: 2,
          plan_name: "MBBS Annual",
        },
      ],
      applications: [],
    });
    assert.equal(view.kind, "active");
    assert.match(view.label, /grace/i);
    assert.equal(view.remainingDays, 1);
  });
});

describe("subscription expiry warning kinds", () => {
  it("maps 7/3/1 day windows and ignores post-end", () => {
    assert.equal(
      subscriptionExpiryWarningKind("2026-09-22T12:00:00.000Z", now),
      "subscription_expiry_7d"
    );
    assert.equal(
      subscriptionExpiryWarningKind("2026-09-18T12:00:00.000Z", now),
      "subscription_expiry_3d"
    );
    assert.equal(
      subscriptionExpiryWarningKind("2026-09-16T00:00:00.000Z", now),
      "subscription_expiry_1d"
    );
    assert.equal(
      subscriptionExpiryWarningKind("2026-09-15T11:00:00.000Z", now),
      null
    );
    assert.equal(
      subscriptionIsLiveAt("active", "2026-09-15T11:00:00.000Z", 0, now),
      false
    );
    assert.equal(
      subscriptionIsLiveAt("active", "2026-09-15T11:00:00.000Z", 1, now),
      true
    );
  });
});

describe("student subscription error messages", () => {
  it("maps known codes without leaking internals", () => {
    assert.match(
      studentSubscriptionErrorMessage("r2_not_configured"),
      /admin/i
    );
    assert.match(
      studentSubscriptionErrorMessage("application_already_pending"),
      /pending/i
    );
    assert.match(
      studentSubscriptionErrorMessage("application_not_pending"),
      /reviewed/i
    );
    assert.match(
      studentSubscriptionErrorMessage("invalid_screenshot_size"),
      /5 MB/i
    );
    assert.equal(
      studentSubscriptionErrorMessage("relation does not exist"),
      "Something went wrong. Please try again."
    );
  });

  it("maps wrapped RPC messages containing known tokens", () => {
    assert.match(
      studentSubscriptionErrorMessage(
        'new row violates check: application_already_pending'
      ),
      /pending/i
    );
  });
});

describe("application and file validation (subscription UI)", () => {
  it("rejects invalid amounts and oversized files", () => {
    assert.equal(validatePaymentAmount(0), "invalid_amount");
    assert.equal(
      validatePaymentScreenshotFile({
        type: "image/jpeg",
        size: 5 * 1024 * 1024 + 1,
      }),
      "invalid_screenshot_size"
    );
    assert.equal(
      validatePaymentScreenshotFile({ type: "application/pdf", size: 100 }),
      "invalid_screenshot_type"
    );
  });
});
