import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SessionProfile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "student";
  active_session_id: string | null;
};

export type Enrollment = {
  id: string;
  year_id: string;
  status: "pending" | "active" | "suspended" | "expired" | "revoked";
  year_number: number;
  year_name: string;
};

// Central auth gate for protected layouts. Enforces the two-layer session
// policy from docs/permissions.md:
//  - Layer 1: JWT session_id must equal profiles.active_session_id
//  - Exemption: a session owning an in_progress attempt is NOT evicted
//    (checked via owns_live_attempt() once the exam engine exists; the
//    is_active_session() DB guard protects exam RPCs regardless).
export async function requireUser() {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");

  const userId = claims.sub as string;
  const sessionId = (claims.session_id as string | undefined) ?? null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, active_session_id")
    .eq("id", userId)
    .single<SessionProfile>();

  if (!profile) redirect("/login");

  if (profile.active_session_id && profile.active_session_id !== sessionId) {
    // Portal session superseded by a newer login (Layer 1 eviction),
    // unless this session owns a live exam attempt.
    const { data: exempt } = await supabase.rpc("owns_live_attempt_session");
    if (!exempt) {
      await supabase.auth.signOut({ scope: "local" });
      redirect("/login?reason=kicked");
    }
  }

  return { supabase, profile, userId, sessionId };
}

export async function requireStudent() {
  const ctx = await requireUser();
  if (ctx.profile.role === "admin") redirect("/admin");

  const { data: enrollment } = await ctx.supabase
    .from("enrollments")
    .select("id, year_id, status, years(year_number, name)")
    .in("status", ["pending", "active"])
    .maybeSingle();

  if (!enrollment) redirect("/pending?state=none");
  if (enrollment.status === "pending") redirect("/pending");

  const years = enrollment.years as unknown as { year_number: number; name: string };
  const result: Enrollment = {
    id: enrollment.id,
    year_id: enrollment.year_id,
    status: enrollment.status,
    year_number: years?.year_number,
    year_name: years?.name,
  };
  return { ...ctx, enrollment: result };
}

export async function requireAdmin() {
  const ctx = await requireUser();
  if (ctx.profile.role !== "admin") redirect("/dashboard");
  return ctx;
}
