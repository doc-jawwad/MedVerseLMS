/**
 * Test builder "who can use this" maps onto existing entitlement columns.
 * Free-only and Free+Paid are the same access law: subscription never
 * removes entitlement=free. Neither is "do not publish" (stay draft).
 */
export type TestStudentAudience = "free" | "paid" | "none";

export function entitlementForTestAudience(
  audience: TestStudentAudience
): "free" | "any_subscription" | null {
  if (audience === "none") return null;
  if (audience === "paid") return "any_subscription";
  return "free";
}

export function testAudienceFromEntitlement(
  entitlement: string | null | undefined,
  status: string | null | undefined
): TestStudentAudience {
  if (status === "draft" && entitlement === "free") {
    // Draft + free is the default create state; the form still shows Free
    // until the admin chooses Neither explicitly at publish time.
    return "free";
  }
  if (entitlement === "any_subscription" || entitlement === "plan") return "paid";
  return "free";
}

export function canPublishToStudents(audience: TestStudentAudience): boolean {
  return audience !== "none";
}
