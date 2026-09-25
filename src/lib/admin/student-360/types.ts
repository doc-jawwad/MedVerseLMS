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
  /** Full biodata for permissioned admins only. */
  biodata: {
    full_name: string;
    email: string;
    contact_number: string | null;
    college_name: string | null;
    avatar_object_key: string | null;
    avatar_url: string | null;
    last_login_at: string | null;
    account_status: string;
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

/** Map admin permission codes → Student 360 sections. */
export function student360SectionsForPermissions(
  perms: ReadonlySet<string>
): AdminStudent360Section[] {
  const sections: AdminStudent360Section[] = [];
  const canStudents =
    perms.has("view_students") ||
    perms.has("manage_students") ||
    perms.has("activate_students") ||
    perms.has("restrict_students");
  const canSubs =
    perms.has("manage_subscriptions") ||
    perms.has("review_subscription_applications");
  const canPayments =
    canSubs || perms.has("manage_payment_settings");
  const canAnalytics = perms.has("view_analytics");

  if (canStudents) {
    sections.push("biodata", "class", "test_history", "practice");
  }
  if (canSubs) sections.push("subscription");
  if (canAnalytics) {
    if (!sections.includes("analytics")) sections.push("analytics");
    if (!sections.includes("test_history")) sections.push("test_history");
    if (!sections.includes("practice")) sections.push("practice");
  }
  if (canPayments) sections.push("payment_history");

  // Basic analytics stats piggy-back on view_students when analytics absent.
  if (canStudents && !sections.includes("analytics")) {
    sections.push("analytics");
  }

  return sections;
}
