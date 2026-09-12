import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — MedVerse LMS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Suspense>
        <LoginForm next={next} reason={reason} />
      </Suspense>
    </div>
  );
}
