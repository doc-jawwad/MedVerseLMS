import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminPermissionSet } from "@/lib/admin/admin-nav";
import {
  student360SectionsForPermissions,
  type AdminStudentDetail,
  type AdminStudentDetailPort,
  type AdminStudentSubscriptionSnapshot,
} from "@/lib/admin/student-360/types";
import { deriveClassLockState } from "@/lib/profile/class-lock";
import { toLeaderboardSafeIdentity } from "@/lib/profile/privacy";
import type { YearOption } from "@/lib/profile/types";
import type {
  PaymentHistoryItem,
  PracticePerformanceSummary,
  StudentAnalyticsStats,
  TestHistoryItem,
} from "@/lib/student-history/types";
import {
  pickLiveEnrollment,
  yearNameFromEnrollment,
} from "@/lib/admin/student-account-ui";
import { subscriptionIsLiveAt } from "@/lib/subscriptions/student-status";
import { avatarProxyUrl } from "@/lib/profile/avatar-url";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type AdminProfileRpc = {
  profile: {
    full_name: string;
    email: string;
    last_login_at: string | null;
  };
  enrollment: {
    status: string;
    year_id: string;
    year_name: string;
  } | null;
  performance: {
    tests_taken: number;
    average_percentage: number;
    highest_percentage: number;
    last_test_at: string | null;
  };
  subject_access: {
    subject_id: string;
    subject_name: string;
    practice_granted: boolean;
  }[];
};

export function createAdminStudentDetailAdapter(
  supabase?: Supabase
): AdminStudentDetailPort {
  async function client() {
    return supabase ?? (await createClient());
  }

  return {
    async listYears() {
      const sb = await client();
      const { data, error } = await sb.rpc("list_years");
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: (data ?? []) as YearOption[] };
    },

    async getStudentDetail(studentId: string) {
      const sb = await client();
      const perms = await getAdminPermissionSet();
      const visible = student360SectionsForPermissions(perms);
      if (visible.length === 0) {
        return { ok: false, error: "permission_denied" };
      }

      const [
        { data: rpcData, error: rpcError },
        { data: accountRow },
        { data: enrollmentRows },
        { count: liveExamCount },
        { data: recentTests },
        { data: practiceRows },
        { data: apps },
        { data: subs },
      ] = await Promise.all([
        sb.rpc("admin_student_profile", { p_student_id: studentId }),
        sb
          .from("profiles")
          .select("account_status")
          .eq("id", studentId)
          .maybeSingle(),
        sb
          .from("enrollments")
          .select("id, status, year_id, years(name)")
          .eq("student_id", studentId),
        sb
          .from("test_attempts")
          .select("id", { count: "exact", head: true })
          .eq("student_id", studentId)
          .eq("state", "in_progress")
          .then((r) => ({ count: r.count })),
        visible.includes("test_history") || visible.includes("analytics")
          ? sb
              .from("test_attempts")
              .select(
                "id, test_id, state, score, max_score, percentage, rank, submitted_at, started_at, tests(title)"
              )
              .eq("student_id", studentId)
              .order("started_at", { ascending: false })
              .limit(25)
          : Promise.resolve({ data: [] as never[], error: null }),
        visible.includes("practice")
          ? sb
              .from("practice_answers")
              .select("id, is_correct, subject_id")
              .eq("student_id", studentId)
          : Promise.resolve({ data: [] as never[], error: null }),
        visible.includes("subscription") || visible.includes("payment_history")
          ? sb
              .from("subscription_applications")
              .select(
                "id, status, amount, currency, created_at, review_note, reviewed_at"
              )
              .eq("student_id", studentId)
              .order("created_at", { ascending: false })
              .limit(40)
          : Promise.resolve({ data: [] as never[], error: null }),
        visible.includes("subscription") || visible.includes("payment_history")
          ? sb
              .from("subscriptions")
              .select(
                "id, status, starts_at, ends_at, grace_days, created_at, subscription_plans(name)"
              )
              .eq("student_id", studentId)
              .order("created_at", { ascending: false })
              .limit(40)
          : Promise.resolve({ data: [] as never[], error: null }),
      ]);

      if (rpcError) return { ok: false, error: rpcError.message };
      const p = rpcData as AdminProfileRpc | null;
      if (!p?.profile) return { ok: false, error: "not_found", notFound: true };

      const liveClass = pickLiveEnrollment(
        (enrollmentRows ?? []) as {
          id: string;
          status: string;
          year_id: string;
          years?: { name?: string | null } | null;
        }[]
      );
      const yearName = liveClass
        ? yearNameFromEnrollment(liveClass)
        : (p.enrollment?.year_name ?? null);
      const yearId = liveClass?.year_id ?? p.enrollment?.year_id ?? null;
      const classStatus = liveClass?.status ?? p.enrollment?.status ?? null;

      const pendingApp =
        (apps ?? []).find((a) => a.status === "pending") ?? null;
      const activeSub =
        (subs ?? []).find((s) =>
          subscriptionIsLiveAt(s.status, s.ends_at, s.grace_days ?? 0)
        ) ?? null;

      const hasLiveSub = Boolean(activeSub);
      const lock = deriveClassLockState({
        currentYearId: yearId,
        currentYearName: yearName,
        currentYearNumber: null,
        hasLiveSubscription: hasLiveSub,
        hasPendingApplication: Boolean(pendingApp),
        pendingApplicationId: pendingApp?.id ?? null,
        pendingApplicationYearId: yearId,
        pendingApplicationYearName: yearName,
        subscriptionYearId: yearId,
        subscriptionYearName: yearName,
      });

      const biodata = {
        full_name: p.profile.full_name,
        email: p.profile.email,
        contact_number: null as string | null,
        college_name: null as string | null,
        avatar_object_key: null as string | null,
        avatar_url: null as string | null,
        last_login_at: p.profile.last_login_at,
        account_status:
          (accountRow?.account_status as string | undefined) ?? "active",
      };

      // Soft-read planned columns if schema lane has added them.
      const { data: extended } = await sb
        .from("profiles")
        .select("*")
        .eq("id", studentId)
        .maybeSingle();
      if (extended && typeof extended === "object") {
        const row = extended as Record<string, unknown>;
        if (typeof row.contact_number === "string") {
          biodata.contact_number = row.contact_number;
        }
        if (typeof row.college_name === "string") {
          biodata.college_name = row.college_name;
        }
        if (typeof row.avatar_object_key === "string") {
          biodata.avatar_object_key = row.avatar_object_key;
          biodata.avatar_url = avatarProxyUrl(
            studentId,
            row.avatar_object_key
          );
        }
      }

      const public_identity = toLeaderboardSafeIdentity({
        id: studentId,
        full_name: biodata.full_name,
        college_name: biodata.college_name,
        avatar_object_key: biodata.avatar_object_key,
      });

      let subscription: AdminStudentSubscriptionSnapshot | null = null;
      if (visible.includes("subscription")) {
        const plan = activeSub?.subscription_plans as unknown as
          | { name: string }
          | { name: string }[]
          | null
          | undefined;
        const planName = Array.isArray(plan)
          ? (plan[0]?.name ?? null)
          : (plan?.name ?? null);
        subscription = {
          has_live: hasLiveSub,
          status_label: activeSub
            ? "Active"
            : pendingApp
              ? "Pending application"
              : "None",
          plan_name: planName,
          starts_at: activeSub?.starts_at ?? null,
          ends_at: activeSub?.ends_at ?? null,
          year_id: yearId,
          year_name: yearName,
          pending_application_id: pendingApp?.id ?? null,
          pending_amount: pendingApp ? Number(pendingApp.amount) : null,
          pending_currency: pendingApp?.currency ?? null,
        };
      }

      const test_history: TestHistoryItem[] = visible.includes("test_history")
        ? (recentTests ?? []).map((row) => {
            const test = row.tests as unknown as { title: string } | null;
            return {
              attempt_id: row.id,
              test_id: row.test_id,
              test_title: test?.title ?? "Test",
              state: row.state,
              score: row.score,
              max_score: row.max_score,
              percentage: row.percentage,
              rank: row.rank,
              submitted_at: row.submitted_at,
              started_at: row.started_at,
            };
          })
        : [];

      const analytics: StudentAnalyticsStats | null = visible.includes(
        "analytics"
      )
        ? {
            tests_taken: p.performance.tests_taken,
            average_percentage: p.performance.average_percentage,
            highest_percentage: p.performance.highest_percentage,
            last_test_at: p.performance.last_test_at,
          }
        : null;

      let practice: PracticePerformanceSummary | null = null;
      if (visible.includes("practice")) {
        const rows = practiceRows ?? [];
        const correct = rows.filter((r) => r.is_correct).length;
        const subjects = new Set(
          rows
            .map((r) => r.subject_id as string | null)
            .filter((id): id is string => Boolean(id))
        );
        practice = {
          answers_count: rows.length,
          correct_count: correct,
          accuracy_percent:
            rows.length === 0
              ? null
              : Math.round((correct / rows.length) * 1000) / 10,
          subjects_practiced: subjects.size,
        };
      }

      const payment_history: PaymentHistoryItem[] = [];
      if (visible.includes("payment_history")) {
        for (const app of apps ?? []) {
          payment_history.push({
            id: app.id,
            kind: "application",
            status: app.status,
            amount: Number(app.amount),
            currency: app.currency,
            plan_name: null,
            created_at: app.created_at,
            starts_at: null,
            ends_at: null,
            review_note: app.review_note,
          });
        }
        for (const sub of subs ?? []) {
          const plan = sub.subscription_plans as unknown as
            | { name: string }
            | { name: string }[]
            | null;
          const planName = Array.isArray(plan)
            ? (plan[0]?.name ?? null)
            : (plan?.name ?? null);
          payment_history.push({
            id: sub.id,
            kind: "subscription",
            status: sub.status,
            amount: null,
            currency: null,
            plan_name: planName,
            created_at: sub.created_at,
            starts_at: sub.starts_at,
            ends_at: sub.ends_at,
            review_note: null,
          });
        }
        payment_history.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }

      const detail: AdminStudentDetail = {
        student_id: studentId,
        biodata,
        public_identity,
        class: {
          year_id: yearId,
          year_name: yearName,
          enrollment_status: classStatus,
          lock,
        },
        subscription,
        test_history,
        analytics,
        practice,
        payment_history,
        practice_grants: (p.subject_access ?? []).map((a) => ({
          subject_id: a.subject_id,
          subject_name: a.subject_name,
          granted: a.practice_granted,
        })),
        has_in_progress_exam: (liveExamCount ?? 0) > 0,
        visible_sections: visible,
      };

      return { ok: true, data: detail };
    },
  };
}
