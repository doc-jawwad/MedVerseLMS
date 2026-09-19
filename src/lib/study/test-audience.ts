/**
 * Test builder "who can use this" maps onto existing entitlement columns.
 * Free and Both are the same access law: entitlement='free' (subscription
 * never removes free access). Neither is "do not publish" (stay draft).
 * Do not invent a second entitlement enum.
 */
export type TestStudentAudience = "free" | "both" | "paid" | "none";

export function entitlementForTestAudience(
  audience: TestStudentAudience
): "free" | "any_subscription" | null {
  if (audience === "none") return null;
  if (audience === "paid") return "any_subscription";
  // free + both → free
  return "free";
}

export function testAudienceFromEntitlement(
  entitlement: string | null | undefined,
  _status?: string | null | undefined
): TestStudentAudience {
  if (entitlement === "any_subscription" || entitlement === "plan") return "paid";
  // Stored free maps to Both in the form — free students and paid students
  // both retain access under entitlement=free.
  return "both";
}

export function canPublishToStudents(audience: TestStudentAudience): boolean {
  return audience !== "none";
}

export const TEST_STUDENT_AUDIENCE_OPTIONS: {
  value: TestStudentAudience;
  label: string;
  hint: string;
}[] = [
  {
    value: "free",
    label: "Free students",
    hint: "Free students can access. Paid students also keep access (subscription never removes free entitlement).",
  },
  {
    value: "both",
    label: "Both Free and Paid",
    hint: "Same access law as Free — stored as entitlement=free.",
  },
  {
    value: "paid",
    label: "Paid students only",
    hint: "Free students see a locked presentation; paid students can access.",
  },
  {
    value: "none",
    label: "Neither — do not publish",
    hint: "Keep the test as draft. Unpublished tests are never in the student catalog.",
  },
];
