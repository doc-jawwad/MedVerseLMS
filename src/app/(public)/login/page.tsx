import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/student/auth-shell";

export const metadata = { title: "Sign in — MedVerse LMS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return (
    <AuthShell>
      <Suspense>
        <LoginForm next={next} reason={reason} />
      </Suspense>
    </AuthShell>
  );
}
