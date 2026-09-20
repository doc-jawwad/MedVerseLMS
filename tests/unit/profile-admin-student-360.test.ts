import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveClassLockState,
  classLockAllowsSelfChange,
} from "../../src/lib/profile/class-lock.ts";
import {
  assertNoPrivateKeys,
  toLeaderboardSafeIdentity,
  stripPrivateProfileFields,
} from "../../src/lib/profile/privacy.ts";
import {
  classLockBadgeLabel,
  classLockHeadline,
  purchaseClassConfirmLabel,
  purchaseClassPrompt,
} from "../../src/lib/profile/presentation.ts";
import {
  validateAvatarFile,
  validateCollegeName,
  validateContactNumber,
  validateFullName,
  validatePurchaseClassConfirmation,
} from "../../src/lib/profile/validation.ts";
import { student360SectionsForPermissions } from "../../src/lib/admin/student-360/types.ts";

describe("class lock derivation", () => {
  it("allows free self-change with no sub or pending app", () => {
    const state = deriveClassLockState({
      currentYearId: "y2",
      currentYearName: "2nd Year MBBS",
      currentYearNumber: 2,
      hasLiveSubscription: false,
      hasPendingApplication: false,
    });
    assert.equal(state.lock, "free");
    assert.equal(state.can_self_change, true);
    assert.equal(classLockAllowsSelfChange(state.lock), true);
    assert.match(classLockHeadline(state), /2nd Year MBBS/);
  });

  it("locks pending application class", () => {
    const state = deriveClassLockState({
      currentYearId: "y2",
      currentYearName: "2nd Year MBBS",
      currentYearNumber: 2,
      hasLiveSubscription: false,
      hasPendingApplication: true,
      pendingApplicationId: "app1",
      pendingApplicationYearId: "y2",
      pendingApplicationYearName: "2nd Year MBBS",
    });
    assert.equal(state.lock, "pending_application");
    assert.equal(state.can_self_change, false);
    assert.match(classLockHeadline(state), /pending subscription is for 2nd Year MBBS/i);
    assert.match(classLockBadgeLabel(state.lock), /locked/i);
  });

  it("locks active subscription to purchased class copy", () => {
    const state = deriveClassLockState({
      currentYearId: "y2",
      currentYearName: "2nd Year MBBS",
      currentYearNumber: 2,
      hasLiveSubscription: true,
      hasPendingApplication: false,
      subscriptionYearId: "y2",
      subscriptionYearName: "2nd Year MBBS",
    });
    assert.equal(state.lock, "active_subscription");
    assert.equal(state.can_self_change, false);
    assert.equal(
      classLockHeadline(state),
      "Your subscription is for 2nd Year MBBS"
    );
  });

  it("prefers live subscription over pending when both present", () => {
    const state = deriveClassLockState({
      currentYearId: "y3",
      currentYearName: "3rd Year MBBS",
      currentYearNumber: 3,
      hasLiveSubscription: true,
      hasPendingApplication: true,
      subscriptionYearName: "3rd Year MBBS",
    });
    assert.equal(state.lock, "active_subscription");
  });
});

describe("profile privacy", () => {
  it("projects leaderboard-safe identity only", () => {
    const safe = toLeaderboardSafeIdentity({
      id: "s1",
      full_name: "Ayesha Khan",
      college_name: "King Edward Medical University",
      avatar_object_key: "study-content/avatars/s1/a",
    });
    assert.deepEqual(Object.keys(safe).sort(), [
      "avatar_object_key",
      "college_name",
      "full_name",
      "student_id",
    ]);
    assert.equal("email" in safe, false);
    assert.equal("contact_number" in safe, false);
  });

  it("strips private keys from arbitrary payloads", () => {
    const cleaned = stripPrivateProfileFields({
      full_name: "A",
      email: "a@x.com",
      contact_number: "0300",
      college_name: "KEMU",
      payment: { amount: 1 },
    });
    assert.equal("email" in cleaned, false);
    assert.equal("contact_number" in cleaned, false);
    assert.equal("payment" in cleaned, false);
    assert.equal(cleaned.college_name, "KEMU");
    assert.deepEqual(assertNoPrivateKeys(cleaned as Record<string, unknown>), []);
  });
});

describe("profile validation", () => {
  it("validates contact, college, name, purchase confirm, avatar", () => {
    assert.equal(validateContactNumber("+923001234567"), null);
    assert.ok(validateContactNumber("12"));
    assert.equal(validateCollegeName("KEMU"), null);
    assert.ok(validateCollegeName("A"));
    assert.equal(validateFullName("Ayesha Khan"), null);
    assert.ok(validateFullName(""));
    assert.equal(
      validatePurchaseClassConfirmation({ yearId: "y1", confirmed: true }),
      null
    );
    assert.ok(
      validatePurchaseClassConfirmation({ yearId: "y1", confirmed: false })
    );
    assert.equal(
      validateAvatarFile({ type: "image/png", size: 1000 }),
      null
    );
    assert.ok(validateAvatarFile({ type: "image/gif", size: 1000 }));
  });

  it("builds purchase confirmation copy", () => {
    assert.match(
      purchaseClassConfirmLabel("2nd Year MBBS"),
      /2nd Year MBBS/
    );
    assert.match(purchaseClassPrompt("2nd Year MBBS"), /purchasing access for/);
  });
});

describe("admin student 360 section permissions", () => {
  it("gates sections by permission codes", () => {
    const studentsOnly = student360SectionsForPermissions(
      new Set(["view_students"])
    );
    assert.ok(studentsOnly.includes("biodata"));
    assert.ok(studentsOnly.includes("class"));
    assert.ok(studentsOnly.includes("test_history"));
    assert.ok(studentsOnly.includes("analytics"));
    assert.equal(studentsOnly.includes("subscription"), false);
    assert.equal(studentsOnly.includes("payment_history"), false);

    const ops = student360SectionsForPermissions(
      new Set(["manage_subscriptions", "review_subscription_applications"])
    );
    assert.ok(ops.includes("subscription"));
    assert.ok(ops.includes("payment_history"));
    assert.equal(ops.includes("biodata"), false);

    const analytics = student360SectionsForPermissions(
      new Set(["view_analytics"])
    );
    assert.ok(analytics.includes("analytics"));
    assert.ok(analytics.includes("test_history"));
    assert.ok(analytics.includes("practice"));
  });
});
