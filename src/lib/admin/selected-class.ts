import "server-only";

import { cookies } from "next/headers";
import {
  ADMIN_CLASS_COOKIE,
  adminClassCookieOptions,
  resolveAdminClassId,
} from "@/lib/admin/admin-class";
import { isYearId } from "@/lib/admin/year-id";

export { ADMIN_CLASS_COOKIE, isYearId };

export async function readAdminSelectedYearId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(ADMIN_CLASS_COOKIE)?.value ?? "";
  return isYearId(value) ? value : null;
}

/**
 * Active admin class for the request.
 * Cookie is authoritative (proxy syncs `?year=` → cookie before RSC).
 */
export async function resolveAdminYearId(
  searchYear?: string | null
): Promise<string | null> {
  return resolveAdminClassId(await readAdminSelectedYearId(), searchYear);
}

export async function writeAdminSelectedYearId(yearId: string): Promise<void> {
  if (!isYearId(yearId)) return;
  const jar = await cookies();
  jar.set(ADMIN_CLASS_COOKIE, yearId, adminClassCookieOptions());
}
