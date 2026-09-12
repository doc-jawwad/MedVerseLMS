import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot password — MedVerse LMS" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <ForgotPasswordForm />
    </div>
  );
}
