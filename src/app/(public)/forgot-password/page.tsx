import { ForgotPasswordForm } from "./forgot-password-form";
import { AuthShell } from "@/components/student/auth-shell";

export const metadata = { title: "Forgot password — MedVerse LMS" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
