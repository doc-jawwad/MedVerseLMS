import "server-only";

import { cookies } from "next/headers";
import { isYearId } from "@/lib/admin/year-id";

export const ADMIN_CLASS_COOKIE = "medverse_admin_year";
export { isYearId };

export async function readAdminSelectedYearId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(ADMIN_CLASS_COOKIE)?.value ?? "";
  return isYearId(value) ? value : null;
}

export async function resolveAdminYearId(
  searchYear?: string | null
): Promise<string | null> {
  if (isYearId(searchYear)) return searchYear;
  return readAdminSelectedYearId();
}

export async function writeAdminSelectedYearId(yearId: string): Promise<void> {
  if (!isYearId(yearId)) return;
  const jar = await cookies();
  jar.set(ADMIN_CLASS_COOKIE, yearId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 180,
    path: "/admin",
  });
}
