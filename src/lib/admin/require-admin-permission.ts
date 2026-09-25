import "server-only";

import { createElement, type ReactNode } from "react";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import {
  adminHasAny,
  getAdminPermissionSet,
} from "@/lib/admin/admin-nav";
import type { AdminPermissionCode } from "@/lib/admin/admin-rbac-ui";

/**
 * Page-level UX gate. Postgres RLS/RPCs remain authoritative.
 * Main Admin short-circuits via getAdminPermissionSet().
 */
export async function requireAdminAnyPermission(
  codes: readonly AdminPermissionCode[],
  title: string
): Promise<
  | { perms: Set<string>; denied: null }
  | { perms: Set<string>; denied: ReactNode }
> {
  const perms = await getAdminPermissionSet();
  if (!adminHasAny(perms, codes)) {
    return {
      perms,
      denied: createElement(AdminPermissionDenied, { title }),
    };
  }
  return { perms, denied: null };
}
