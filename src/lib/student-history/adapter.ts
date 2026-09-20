import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { StudentHistoryPort } from "@/lib/student-history/ports";
import type {
  PaymentHistoryItem,
  PracticePerformanceSummary,
  StudentAnalyticsStats,
  StudentHistoryBundle,
  TestHistoryItem,
} from "@/lib/student-history/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function currentUserId(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

export function createStudentHistoryAdapter(
  supabase?: Supabase
): StudentHistoryPort {
  async function client() {
    return supabase ?? (await createClient());
  }

  return {
    async getOwnHistory(options) {
      const sb = await client();
      const userId = await currentUserId(sb);
      if (!userId) return { ok: false, error: "not_authenticated" };
      const limit = options?.testLimit ?? 20;

      const [attemptsRes, practiceRes, appsRes, subsRes] = await Promise.all([
        sb
          .from("test_attempts")
          .select(
            "id, test_id, state, score, max_score, percentage, rank, submitted_at, started_at, tests(title)"
          )
          .eq("student_id", userId)
          .order("started_at", { ascending: false })
          .limit(limit),
        sb
          .from("practice_answers")
          .select("id, is_correct, subject_id")
          .eq("student_id", userId),
        sb
          .from("subscription_applications")
          .select(
            "id, status, amount, currency, created_at, review_note, reviewed_at"
          )
          .eq("student_id", userId)
          .order("created_at", { ascending: false })
          .limit(30),
        sb
          .from("subscriptions")
          .select(
            "id, status, starts_at, ends_at, created_at, subscription_plans(name)"
          )
          .eq("student_id", userId)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

      if (attemptsRes.error) {
        return { ok: false, error: attemptsRes.error.message };
      }

      const test_history: TestHistoryItem[] = (attemptsRes.data ?? []).map(
        (row) => {
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
        }
      );

      const submitted = test_history.filter((t) => t.state === "submitted");
      const percentages = submitted
        .map((t) => t.percentage)
        .filter((p): p is number => p != null);
      const analytics: StudentAnalyticsStats = {
        tests_taken: submitted.length,
        average_percentage:
          percentages.length === 0
            ? 0
            : Math.round(
                (percentages.reduce((a, b) => a + b, 0) / percentages.length) *
                  100
              ) / 100,
        highest_percentage:
          percentages.length === 0 ? 0 : Math.max(...percentages),
        last_test_at: submitted[0]?.submitted_at ?? null,
      };

      const practiceRows = practiceRes.error ? [] : (practiceRes.data ?? []);
      const correct = practiceRows.filter((r) => r.is_correct).length;
      const subjects = new Set(
        practiceRows
          .map((r) => r.subject_id as string | null)
          .filter((id): id is string => Boolean(id))
      );
      const practice: PracticePerformanceSummary = {
        answers_count: practiceRows.length,
        correct_count: correct,
        accuracy_percent:
          practiceRows.length === 0
            ? null
            : Math.round((correct / practiceRows.length) * 1000) / 10,
        subjects_practiced: subjects.size,
      };

      const payments: PaymentHistoryItem[] = [];
      for (const app of appsRes.data ?? []) {
        payments.push({
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
      for (const sub of subsRes.data ?? []) {
        const plan = sub.subscription_plans as unknown as
          | { name: string }
          | { name: string }[]
          | null;
        const planName = Array.isArray(plan)
          ? (plan[0]?.name ?? null)
          : (plan?.name ?? null);
        payments.push({
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
      payments.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const bundle: StudentHistoryBundle = {
        test_history,
        practice,
        analytics,
        payments,
      };
      return { ok: true, data: bundle };
    },
  };
}
