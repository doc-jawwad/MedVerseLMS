export const ADMIN_PERMISSION_CATALOG = [
  { code: "manage_admins", label: "Manage admins" },
  { code: "manage_system_settings", label: "System settings" },
  { code: "view_students", label: "View students" },
  { code: "manage_students", label: "Edit student profiles" },
  { code: "activate_students", label: "Restore LMS access" },
  { code: "restrict_students", label: "Block student LMS access" },
  { code: "manage_subscriptions", label: "Manage subscriptions" },
  { code: "review_subscription_applications", label: "Review payment applications" },
  { code: "manage_payment_settings", label: "Payment instructions" },
  { code: "grant_resource_access", label: "Grants and restrictions" },
  { code: "manage_year_changes", label: "Year changes" },
  { code: "edit_questions", label: "Edit questions" },
  { code: "import_questions", label: "Import questions" },
  { code: "publish_tests", label: "Publish tests" },
  { code: "manage_materials", label: "Manage materials" },
  { code: "view_analytics", label: "View analytics" },
] as const;

export type AdminPermissionCode =
  (typeof ADMIN_PERMISSION_CATALOG)[number]["code"];

export type AdminPresetId = "academic" | "operations" | "custom";

export const ADMIN_PRESETS: {
  id: AdminPresetId;
  label: string;
  description: string;
  codes: readonly AdminPermissionCode[];
}[] = [
  {
    id: "academic",
    label: "Academic / MCQ",
    description: "Question bank, tests, materials, analytics",
    codes: [
      "edit_questions",
      "import_questions",
      "publish_tests",
      "manage_materials",
      "view_analytics",
    ],
  },
  {
    id: "operations",
    label: "Operations",
    description: "Students, subscriptions, year changes, access",
    codes: [
      "view_students",
      "manage_students",
      "activate_students",
      "restrict_students",
      "manage_subscriptions",
      "review_subscription_applications",
      "manage_payment_settings",
      "grant_resource_access",
      "manage_year_changes",
    ],
  },
  {
    id: "custom",
    label: "Custom",
    description: "Pick individual jobs",
    codes: [],
  },
];

export type AdminAccountRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  account_status: string | null;
  is_main_admin: boolean;
  last_login_at: string | null;
  permission_codes: string[];
};

export function isBlockedAdminStatus(status: string | null | undefined): boolean {
  return (
    status === "restricted" ||
    status === "suspended" ||
    status === "deactivated" ||
    status === "revoked"
  );
}

export function countActiveMainAdmins(rows: AdminAccountRow[]): number {
  return rows.filter((r) => r.is_main_admin && !isBlockedAdminStatus(r.account_status))
    .length;
}

export function isLastActiveMainAdmin(
  rows: AdminAccountRow[],
  adminId: string
): boolean {
  const target = rows.find((r) => r.id === adminId);
  if (!target?.is_main_admin || isBlockedAdminStatus(target.account_status)) {
    return false;
  }
  return countActiveMainAdmins(rows) === 1;
}

export function canDisableAdmin(
  rows: AdminAccountRow[],
  adminId: string
): boolean {
  return !isLastActiveMainAdmin(rows, adminId);
}

export function canDemoteAdmin(
  rows: AdminAccountRow[],
  adminId: string
): boolean {
  const target = rows.find((r) => r.id === adminId);
  if (!target) return false;
  if (!target.is_main_admin) return true;
  return rows.filter((r) => r.is_main_admin && r.id !== adminId).length > 0;
}

export function codesForPreset(preset: AdminPresetId): AdminPermissionCode[] {
  const found = ADMIN_PRESETS.find((p) => p.id === preset);
  return found ? [...found.codes] : [];
}

export function adminRbacErrorMessage(raw: string | null | undefined): string {
  const t = String(raw ?? "");
  if (/cannot disable the last active Main Admin/i.test(t)) {
    return "The last active Main Admin cannot be blocked.";
  }
  if (/cannot demote the last Main Admin/i.test(t)) {
    return "The last Main Admin cannot be removed or demoted.";
  }
  if (/permission_denied/i.test(t) || /admin only/i.test(t)) {
    return "You do not have permission to manage admins.";
  }
  if (/target is not an admin/i.test(t)) {
    return "That account is not an admin.";
  }
  if (/profile not found/i.test(t)) {
    return "No account was found for that email.";
  }
  if (/already registered|already been registered|email_exists|User already registered/i.test(t)) {
    return "That email already has an account. Promote the existing student instead.";
  }
  if (/Password must be at least 8/i.test(t)) {
    return "Password must be at least 8 characters.";
  }
  return "Could not update admins. Please try again.";
}
