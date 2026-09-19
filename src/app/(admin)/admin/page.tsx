import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import {
  adminHasAny,
  getAdminPermissionSet,
} from "@/lib/admin/admin-nav";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Admin — MedVerse LMS" };

type PlatformSummary = {
  active_students: number;
  inactive_students: number;
  tests_this_month: number;
  total_attempts: number;
  average_score_pct: number;
  hardest_topic: string | null;
  best_subject: string | null;
  participation_pct: number;
};

type DifficultQuestion = {
  question_id: string;
  stem: string;
  subject_name: string;
  attempts: number;
  correct: number;
  p_value: number;
};

export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();
  const perms = await getAdminPermissionSet();
  const canReadStudents = adminHasAny(perms, [
    "view_students",
    "manage_students",
    "activate_students",
    "restrict_students",
  ]);
  const canViewAnalytics = perms.has("view_analytics");

  const [blockedRes, summaryRes, difficultyRes] = await Promise.all([
    canReadStudents
      ? supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "student")
          .in("account_status", [
            "restricted",
            "suspended",
            "deactivated",
            "revoked",
          ])
          .then((r) => ({ data: r.count }))
      : Promise.resolve({ data: null as number | null }),
    canViewAnalytics
      ? supabase.rpc("admin_platform_summary")
      : Promise.resolve({ data: null }),
    canViewAnalytics
      ? supabase.rpc("question_difficulty_report", { p_limit: 5 })
      : Promise.resolve({ data: null }),
  ]);

  const blockedCount = blockedRes.data;
  const s = summaryRes.data as PlatformSummary | null;
  const missed = (difficultyRes.data ?? []) as DifficultQuestion[];

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Overview</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canReadStudents ? (
          <Link href="/admin/students?account=blocked">
            <Tile value={blockedCount ?? 0} label="Blocked accounts" />
          </Link>
        ) : (
          <Tile value="—" label="Blocked accounts" />
        )}
        {canReadStudents && canViewAnalytics ? (
          <Link href="/admin/students">
            <Tile value={s?.active_students ?? 0} label="Active students" />
          </Link>
        ) : (
          <Tile
            value={canViewAnalytics ? (s?.active_students ?? 0) : "—"}
            label="Active students"
          />
        )}
        <Tile
          value={canViewAnalytics ? (s?.tests_this_month ?? 0) : "—"}
          label="Tests this month"
        />
        <Tile
          value={canViewAnalytics ? (s?.total_attempts ?? 0) : "—"}
          label="Total attempts"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          value={canViewAnalytics ? `${s?.average_score_pct ?? 0}%` : "—"}
          label="Average score"
        />
        <Tile
          value={canViewAnalytics ? `${s?.participation_pct ?? 0}%` : "—"}
          label="Participation rate"
        />
        <Tile
          value={canViewAnalytics ? (s?.best_subject ?? "—") : "—"}
          label="Highest-performing subject"
          small
        />
        <Tile
          value={canViewAnalytics ? (s?.hardest_topic ?? "—") : "—"}
          label="Most difficult topic"
          small
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most missed questions</CardTitle>
          <CardDescription>
            Lowest correctness across tests and practice (minimum 3 attempts)
          </CardDescription>
        </CardHeader>
        <div className="grid gap-1 px-6 pb-6">
          {!canViewAnalytics && (
            <p className="text-sm text-muted-foreground">
              Analytics permission required.
            </p>
          )}
          {canViewAnalytics &&
            missed.map((q) => (
              <Link
                key={q.question_id}
                href={`/admin/questions/${q.question_id}`}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm transition-colors hover:bg-accent/50"
              >
                <span className="truncate">{q.stem}</span>
                <span className="shrink-0 text-muted-foreground">
                  {q.subject_name} · {q.p_value}% correct ({q.attempts})
                </span>
              </Link>
            ))}
          {canViewAnalytics && missed.length === 0 && (
            <p className="text-sm text-muted-foreground">Not enough data yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function Tile({
  value,
  label,
  small,
}: {
  value: string | number;
  label: string;
  small?: boolean;
}) {
  return (
    <Card className="transition-colors hover:bg-accent/40">
      <CardHeader>
        <CardTitle className={small ? "truncate text-lg" : "text-3xl"}>
          {value}
        </CardTitle>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
    </Card>
  );
}
