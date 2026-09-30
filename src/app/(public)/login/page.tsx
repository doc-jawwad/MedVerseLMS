import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/student/auth-shell";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";

export const metadata = { title: "Sign in — MedVerse LMS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  // Kick / session_expired must still show the form (cookies may be stale).
  if (reason !== "kicked" && reason !== "session_expired") {
    await redirectIfAuthenticated(next);
  }

  return (
    <AuthShell>
      <Suspense>
        <LoginForm next={next} reason={reason} />
      </Suspense>
    </AuthShell>
  );
}
