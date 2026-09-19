import { Suspense } from "react";
import { VerifyEmailForm } from "./verify-email-form";
import { readVerifyEmailCookie } from "@/lib/auth/verify-email-cookie";

export const metadata = { title: "Verify your email — MedVerse LMS" };

export default async function VerifyEmailPage() {
  // Email comes from an httpOnly cookie set at signup/sign-in — never from the URL query string.
  const email = await readVerifyEmailCookie();
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Suspense>
        <VerifyEmailForm email={email} />
      </Suspense>
    </div>
  );
}
