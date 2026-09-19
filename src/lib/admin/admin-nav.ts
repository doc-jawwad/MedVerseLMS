import "server-only";

import { cache } from "react";
import { requireAdmin } from "@/lib/auth/require-user";
import {
  ADMIN_PERMISSION_CATALOG,
  type AdminPermissionCode,
} from "@/lib/admin/admin-rbac-ui";
import type { NavItem } from "@/components/mobile-nav";

const ALL_CODES: readonly AdminPermissionCode[] = ADMIN_PERMISSION_CATALOG.map(
  (c) => c.code
);

/** Cached permission set for the signed-in admin. Main Admin ⇒ all codes. */
export const getAdminPermissionSet = cache(async function getAdminPermissionSet() {
  const { supabase, profile, userId } = await requireAdmin();

  if (profile.is_main_admin) {
    return new Set<string>(ALL_CODES);
  }

  const { data } = await supabase
    .from("admin_permissions")
    .select("permission_code")
    .eq("admin_id", userId);

  return new Set((data ?? []).map((r) => r.permission_code));
});

export function adminHasAny(
  perms: Set<string>,
  codes: readonly AdminPermissionCode[]
): boolean {
  return codes.some((c) => perms.has(c));
}

export type AdminNavDef = NavItem & {
  /** Omit = visible to every admin (role gate only). */
  anyOf?: readonly AdminPermissionCode[];
};

export const ADMIN_NAV: AdminNavDef[] = [
  { href: "/admin", label: "Overview", icon: "dashboard" },
  {
    href: "/admin/students",
    label: "Students",
    icon: "students",
    anyOf: [
      "view_students",
      "manage_students",
      "activate_students",
      "restrict_students",
    ],
  },
  {
    href: "/admin/admins",
    label: "Admins",
    icon: "admins",
    anyOf: ["manage_admins"],
  },
  {
    href: "/admin/year-changes",
    label: "Year changes",
    icon: "students",
    anyOf: ["manage_year_changes"],
  },
  {
    href: "/admin/subscriptions",
    label: "Subscriptions",
    icon: "subscription",
    anyOf: [
      "manage_subscriptions",
      "review_subscription_applications",
      "manage_payment_settings",
    ],
  },
  { href: "/admin/curriculum", label: "Curriculum", icon: "curriculum" },
  {
    href: "/admin/questions",
    label: "Question Bank",
    icon: "questions",
    anyOf: ["edit_questions", "import_questions"],
  },
  {
    href: "/admin/tests",
    label: "Tests",
    icon: "tests",
    anyOf: ["publish_tests", "view_analytics"],
  },
  {
    href: "/admin/materials",
    label: "Materials",
    icon: "materialsFolder",
    anyOf: ["manage_materials"],
  },
  {
    href: "/admin/audit-logs",
    label: "Audit Log",
    icon: "auditLog",
    anyOf: ["manage_admins", "manage_system_settings"],
  },
];

export function filterAdminNav(perms: Set<string>): NavItem[] {
  return ADMIN_NAV.filter(
    (item) => !item.anyOf || adminHasAny(perms, item.anyOf)
  ).map(({ href, label, icon }) => ({ href, label, icon }));
}
