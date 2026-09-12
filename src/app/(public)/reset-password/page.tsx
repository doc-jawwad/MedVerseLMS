import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Reset password — MedVerse LMS" };

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <ResetPasswordForm />
    </div>
  );
}
