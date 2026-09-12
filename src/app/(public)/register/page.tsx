import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Register — MedVerse LMS" };

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data: years } = await supabase.rpc("list_years");

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <RegisterForm years={years ?? []} />
    </div>
  );
}
