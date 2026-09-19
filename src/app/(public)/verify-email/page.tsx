import { Suspense } from "react";
import { VerifyEmailForm } from "./verify-email-form";
import { readVerifyEmailCookie } from "@/lib/auth/verify-email-cookie";
import { AuthShell } from "@/components/student/auth-shell";

export const metadata = { title: "Verify your email — MedVerse LMS" };

export default async function VerifyEmailPage() {
  // Email comes from an httpOnly cookie set at signup/sign-in — never from the URL query string.
  const email = await readVerifyEmailCookie();
  return (
    <AuthShell>
      <Suspense>
        <VerifyEmailForm email={email} />
      </Suspense>
    </AuthShell>
  );
}
