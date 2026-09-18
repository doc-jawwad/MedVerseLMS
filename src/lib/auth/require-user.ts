import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  type AccountStatus,
  isBlockedAccountStatus,
} from "@/lib/auth/account-status";
import { ssrSpan } from "@/lib/observability/ssr-timing-rsc";

export type SessionProfile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "student";
  account_status: AccountStatus;
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
//  - Account status: non-active accounts cannot enter LMS shells
//  - Exemption: a session owning an in_progress attempt is NOT evicted
//    (leave_in_progress disposition / login-kick exam exemption)
export const requireUser = cache(async function requireUser() {
  const supabase = await ssrSpan("auth.createClient", () => createClient());

  const { data } = await ssrSpan("auth.getClaims", () =>
    supabase.auth.getClaims()
  );
  const claims = data?.claims;
  if (!claims) redirect("/login");

  const userId = claims.sub as string;
  const sessionId = (claims.session_id as string | undefined) ?? null;

  const { data: profile } = await ssrSpan("auth.profiles", () =>
    supabase
      .from("profiles")
      .select("id, full_name, email, role, account_status, active_session_id")
      .eq("id", userId)
      .single<SessionProfile>()
  );

  if (!profile) redirect("/login");

  if (profile.active_session_id && profile.active_session_id !== sessionId) {
    const { data: exempt } = await ssrSpan("auth.session_kick_check", () =>
      supabase.rpc("owns_live_attempt_session")
    );
    if (!exempt) {
      await supabase.auth.signOut({ scope: "local" });
      redirect("/login?reason=kicked");
    }
  }

  if (isBlockedAccountStatus(profile.account_status)) {
    const { data: exempt } = await ssrSpan("auth.account_status_check", () =>
      supabase.rpc("owns_live_attempt_session")
    );
    if (!exempt) {
      redirect(`/pending?state=${profile.account_status}`);
    }
  }

  return { supabase, profile, userId, sessionId };
});

export const requireStudent = cache(async function requireStudent() {
  const ctx = await requireUser();
  if (ctx.profile.role === "admin" && ctx.profile.account_status === "active") {
    redirect("/admin");
  }

  const { data: enrollment } = await ssrSpan("auth.enrollments", () =>
    ctx.supabase
      .from("enrollments")
      .select("id, year_id, status, years(year_number, name)")
      .eq("status", "active")
      .maybeSingle()
  );

  if (!enrollment) redirect("/pending?state=none");

  const years = enrollment.years as unknown as { year_number: number; name: string };
  const result: Enrollment = {
    id: enrollment.id,
    year_id: enrollment.year_id,
    status: enrollment.status,
    year_number: years?.year_number,
    year_name: years?.name,
  };
  return { ...ctx, enrollment: result };
});

export const requireAdmin = cache(async function requireAdmin() {
  const ctx = await requireUser();
  if (isBlockedAccountStatus(ctx.profile.account_status)) {
    redirect(`/pending?state=${ctx.profile.account_status}`);
  }
  if (ctx.profile.role !== "admin") redirect("/dashboard");
  return ctx;
});
