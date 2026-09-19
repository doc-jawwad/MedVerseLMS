import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TEST_STUDENT_AUDIENCE_OPTIONS,
  canPublishToStudents,
  entitlementForTestAudience,
  testAudienceFromEntitlement,
  type TestStudentAudience,
} from "../../src/lib/study/test-audience.ts";

describe("test builder audience", () => {
  it("exposes Free / Both / Paid / Neither options", () => {
    assert.deepEqual(
      TEST_STUDENT_AUDIENCE_OPTIONS.map((o) => o.value),
      ["free", "both", "paid", "none"]
    );
  });

  it("Neither blocks publish; Free and Both share entitlement=free", () => {
    const cases: {
      audience: TestStudentAudience;
      entitlement: "free" | "any_subscription" | null;
      canPublish: boolean;
    }[] = [
      { audience: "free", entitlement: "free", canPublish: true },
      { audience: "both", entitlement: "free", canPublish: true },
      { audience: "paid", entitlement: "any_subscription", canPublish: true },
      { audience: "none", entitlement: null, canPublish: false },
    ];
    for (const c of cases) {
      assert.equal(entitlementForTestAudience(c.audience), c.entitlement);
      assert.equal(canPublishToStudents(c.audience), c.canPublish);
    }
  });

  it("reads stored free entitlement as Both in the form", () => {
    assert.equal(testAudienceFromEntitlement("free"), "both");
    assert.equal(testAudienceFromEntitlement("any_subscription"), "paid");
    assert.equal(testAudienceFromEntitlement("plan"), "paid");
  });
});
