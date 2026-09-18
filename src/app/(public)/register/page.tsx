import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Register — MedVerse LMS" };

type Year = { id: string; year_number: number; name: string };

// VPS PostgREST (POSTGREST_INTERNAL_URL) rejects sb_publishable_* keys
// (PGRST301). list_years is anon-granted and works on loopback without a JWT.
// Managed/local Supabase has no internal URL — use supabase-js as before.
async function loadYears(): Promise<Year[]> {
  const internal = process.env.POSTGREST_INTERNAL_URL?.trim().replace(/\/$/, "");
  if (internal) {
    try {
      const res = await fetch(`${internal}/rpc/list_years`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as Year[]) : [];
    } catch {
      return [];
    }
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_years");
  return (data as Year[] | null) ?? [];
}

export default async function RegisterPage() {
  const years = await loadYears();

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <RegisterForm years={years} />
    </div>
  );
}
