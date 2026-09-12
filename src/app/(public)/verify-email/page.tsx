import { Suspense } from "react";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata = { title: "Verify your email — MedVerse LMS" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Suspense>
        <VerifyEmailForm email={email ?? ""} />
      </Suspense>
    </div>
  );
}
