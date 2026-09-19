import { ResetPasswordForm } from "./reset-password-form";
import { AuthShell } from "@/components/student/auth-shell";

export const metadata = { title: "Reset password — MedVerse LMS" };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <ResetPasswordForm />
    </AuthShell>
  );
}
