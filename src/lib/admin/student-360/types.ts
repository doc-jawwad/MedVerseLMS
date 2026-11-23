import type {
  ClassLockState,
  LeaderboardSafeIdentity,
  YearOption,
} from "@/lib/profile/types";
import type {
  PaymentHistoryItem,
  PracticePerformanceSummary,
  StudentAnalyticsStats,
  TestHistoryItem,
} from "@/lib/student-history/types";

export type AdminStudent360Section =
  | "biodata"
  | "account_status"
  | "class"
  | "subscription"
  | "test_history"
  | "analytics"
  | "practice"
  | "payment_history";

export type AdminStudentSubscriptionSnapshot = {
  has_live: boolean;
  status_label: string;
  plan_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  year_id: string | null;
  year_name: string | null;
  pending_application_id: string | null;
  pending_amount: number | null;
  pending_currency: string | null;
};

export type AdminStudentDetail = {
  student_id: string;
  /**
   * Biodata fields are populated only with `view_students`; otherwise they
   * stay null. full_name is also readable by other profile-reading roles.
   */
  biodata: {
    full_name: string | null;
    email: string | null;
    contact_number: string | null;
    college_name: string | null;
    avatar_object_key: string | null;
    avatar_url: string | null;
    last_login_at: string | null;
    /** null when the caller cannot read profiles (never defaulted). */
    account_status: string | null;
  };
  /** Public-safe projection (never includes phone/email/payment). */
  public_identity: LeaderboardSafeIdentity;
  class: {
    year_id: string | null;
    year_name: string | null;
    enrollment_status: string | null;
    lock: ClassLockState;
  };
  subscription: AdminStudentSubscriptionSnapshot | null;
  test_history: TestHistoryItem[];
  analytics: StudentAnalyticsStats | null;
  practice: PracticePerformanceSummary | null;
  payment_history: PaymentHistoryItem[];
  practice_grants: { subject_id: string; subject_name: string; granted: boolean }[];
  has_in_progress_exam: boolean;
  /** Which sections the caller may view. */
  visible_sections: AdminStudent360Section[];
};

export type AdminStudentDetailResult =
  | { ok: true; data: AdminStudentDetail }
  | { ok: false; error: string; notFound?: boolean };

export interface AdminStudentDetailPort {
  getStudentDetail(studentId: string): Promise<AdminStudentDetailResult>;
  listYears(): Promise<{ ok: true; data: YearOption[] } | { ok: false; error: string }>;
}

/** Permissions that admit an admin to the Student 360 page at all. */
export const STUDENT_360_ADMIT_PERMISSIONS = [
  "view_students",
  "manage_students",
  "activate_students",
  "restrict_students",
  "view_analytics",
  "manage_subscriptions",
  "review_subscription_applications",
] as const;

/**
 * Map admin permission codes → Student 360 sections (least privilege).
 * Each section is granted only where existing RLS / RPC gates already let
 * that permission read the underlying data. Nothing here widens SQL access.
 *
 * - biodata (email, contact, college, last login, avatar): view_students only
 * - account_status: roles that can read profiles
 * - class: roles that can read enrollments
 * - analytics / test_history / practice: view_students or view_analytics
 * - subscription / payment_history: subscription roles only
 */
export function student360SectionsForPermissions(
  perms: ReadonlySet<string>
): AdminStudent360Section[] {
  if (!STUDENT_360_ADMIT_PERMISSIONS.some((p) => perms.has(p))) return [];

  const canViewStudents = perms.has("view_students");
  const canProfiles =
    canViewStudents ||
    perms.has("manage_students") ||
    perms.has("activate_students") ||
    perms.has("restrict_students");
  const canEnrollments =
    canViewStudents ||
    perms.has("manage_subscriptions") ||
    perms.has("grant_resource_access") ||
    perms.has("manage_year_changes");
  const canSubs =
    perms.has("manage_subscriptions") ||
    perms.has("review_subscription_applications");
  const canStats = canViewStudents || perms.has("view_analytics");

  const sections: AdminStudent360Section[] = [];
  if (canViewStudents) sections.push("biodata");
  if (canProfiles) sections.push("account_status");
  if (canEnrollments) sections.push("class");
  if (canStats) sections.push("test_history", "analytics", "practice");
  if (canSubs) sections.push("subscription", "payment_history");
  return sections;
}
