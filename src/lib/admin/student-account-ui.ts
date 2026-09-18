function isBlockedAccount(status: string | null | undefined): boolean {
  return (
    status === "restricted" ||
    status === "suspended" ||
    status === "deactivated" ||
    status === "revoked"
  );
}

type AccountStatus =
  | "active"
  | "restricted"
  | "suspended"
  | "deactivated"
  | "revoked";

type AccountStatusAction = AccountStatus;
type AttemptDisposition = "leave_in_progress" | "invalidate" | "finalize";

export const ACCOUNT_FILTERS = [
  { id: "", label: "All" },
  { id: "active", label: "Can use LMS" },
  { id: "blocked", label: "Blocked" },
  { id: "restricted", label: "Restricted" },
  { id: "suspended", label: "Suspended" },
  { id: "deactivated", label: "Deactivated" },
  { id: "revoked", label: "Revoked" },
] as const;

export const EXAM_DISPOSITIONS: {
  id: AttemptDisposition;
  label: string;
  description: string;
  requiresReason: boolean;
}[] = [
  {
    id: "leave_in_progress",
    label: "Let them finish the exam",
    description: "LMS access is blocked, but the open exam can continue on the same device until it ends normally.",
    requiresReason: false,
  },
  {
    id: "finalize",
    label: "Submit the exam now",
    description: "Score the paper as it stands and close it.",
    requiresReason: false,
  },
  {
    id: "invalidate",
    label: "Void the exam",
    description: "Keep the attempt on record as voided. A reason is required.",
    requiresReason: true,
  },
];

const ACCOUNT_LABELS: Record<AccountStatus, string> = {
  active: "Can use LMS",
  restricted: "Restricted",
  suspended: "Suspended",
  deactivated: "Deactivated",
  revoked: "Revoked",
};

export function accountStatusLabel(status: string | null | undefined): string {
  if (status && status in ACCOUNT_LABELS) {
    return ACCOUNT_LABELS[status as AccountStatus];
  }
  return "Unknown";
}

export function accountStatusBadgeVariant(
  status: string | null | undefined
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "revoked") return "destructive";
  if (status === "restricted") return "outline";
  return "secondary";
}

/** Class-row wording only. Never used as LMS account status. */
export function enrollmentClassLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Current class";
    case "expired":
      return "Previous class";
    case "pending":
      return "Historical class row";
    case "suspended":
      return "Historical class hold";
    case "revoked":
      return "Historical class row";
    default:
      return "No class assigned";
  }
}

export type EnrollmentRow = {
  id: string;
  status: string;
  year_id: string;
  years?: { name?: string | null } | { name?: string | null }[] | null;
};

export function pickLiveEnrollment<T extends EnrollmentRow>(
  rows: T[] | null | undefined
): T | null {
  if (!rows?.length) return null;
  return rows.find((r) => r.status === "active") ?? null;
}

export function yearNameFromEnrollment(
  enrollment: EnrollmentRow | null
): string {
  if (!enrollment) return "—";
  const y = enrollment.years;
  const name = Array.isArray(y) ? y[0]?.name : y?.name;
  return name || "—";
}

export function matchesAccountFilter(
  accountStatus: string | null | undefined,
  filter: string | undefined
): boolean {
  const f = filter ?? "";
  if (!f) return true;
  if (f === "blocked") return isBlockedAccount(accountStatus);
  return accountStatus === f;
}

export function requiresExamDisposition(args: {
  nextStatus: AccountStatusAction;
  hasInProgressExam: boolean;
}): boolean {
  return isBlockedAccount(args.nextStatus) && args.hasInProgressExam;
}

export function invalidateRequiresReason(
  disposition: AttemptDisposition | null | undefined
): boolean {
  return disposition === "invalidate";
}

export function canSubmitAccountStatusChange(args: {
  nextStatus: AccountStatusAction;
  hasInProgressExam: boolean;
  disposition: AttemptDisposition | null;
  reason: string;
}): boolean {
  if (!requiresExamDisposition(args)) return true;
  if (!args.disposition) return false;
  if (invalidateRequiresReason(args.disposition) && !args.reason.trim()) {
    return false;
  }
  return true;
}

export type ManageMenuItem = {
  id: string;
  group: "account" | "class" | "resources";
};

/** Menu ids the student admin UI may show. Enrollment LMS-gate ids are forbidden. */
export function studentManageMenuItems(ctx: {
  accountStatus: string;
  hasActiveClass: boolean;
  hasYearForResources: boolean;
}): ManageMenuItem[] {
  const items: ManageMenuItem[] = [];
  if (isBlockedAccount(ctx.accountStatus)) {
    items.push({ id: "restore_lms", group: "account" });
  } else {
    items.push(
      { id: "restrict_lms", group: "account" },
      { id: "suspend_lms", group: "account" },
      { id: "deactivate_lms", group: "account" },
      { id: "revoke_lms", group: "account" }
    );
  }
  if (ctx.hasActiveClass) {
    items.push({ id: "promote_class", group: "class" });
  }
  if (ctx.hasYearForResources) {
    items.push({ id: "resource_access", group: "resources" });
  }
  return items;
}

export const FORBIDDEN_ENROLLMENT_LMS_GATE_IDS = [
  "approve_enrollment",
  "suspend_enrollment",
  "revoke_enrollment",
  "reactivate_enrollment",
] as const;

export function accountStatusErrorMessage(raw: string | null | undefined): string {
  const t = String(raw ?? "");
  if (/attempt_disposition_required/i.test(t)) {
    return "This student has an exam in progress. Choose what should happen to that exam.";
  }
  if (/reason required/i.test(t)) {
    return "A reason is required to void the exam.";
  }
  if (/permission_denied/i.test(t)) {
    return "You do not have permission to change this account.";
  }
  if (/admin only/i.test(t)) {
    return "You do not have permission to change this account.";
  }
  return "Could not update account access. Please try again.";
}

export const BLOCKING_ACCOUNT_ACTIONS: {
  status: AccountStatusAction;
  menuId: string;
  label: string;
  description: string;
}[] = [
  {
    status: "restricted",
    menuId: "restrict_lms",
    label: "Restrict LMS access",
    description: "Block this student from the LMS until you restore access.",
  },
  {
    status: "suspended",
    menuId: "suspend_lms",
    label: "Suspend LMS access",
    description: "Temporarily block this student from the LMS.",
  },
  {
    status: "deactivated",
    menuId: "deactivate_lms",
    label: "Deactivate account",
    description: "Turn off LMS access for a longer offboarding hold.",
  },
  {
    status: "revoked",
    menuId: "revoke_lms",
    label: "Revoke LMS access",
    description: "Permanently bar this student. A main admin can still restore access later.",
  },
];
