import "server-only";

import { cookies } from "next/headers";

/** HttpOnly cookie carries verify-email address — never put email in the URL. */
export const VERIFY_EMAIL_COOKIE = "mv_verify_email";

const MAX_AGE_SEC = 60 * 60; // 1 hour

export async function setVerifyEmailCookie(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) return;
  const jar = await cookies();
  jar.set(VERIFY_EMAIL_COOKIE, trimmed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SEC,
    path: "/",
  });
}

export async function readVerifyEmailCookie(): Promise<string> {
  const jar = await cookies();
  return jar.get(VERIFY_EMAIL_COOKIE)?.value?.trim() ?? "";
}

export async function clearVerifyEmailCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(VERIFY_EMAIL_COOKIE);
}
