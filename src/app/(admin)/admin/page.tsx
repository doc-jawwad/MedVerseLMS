import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
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

  const [{ data: pendingCount }, { data: summaryData }, { data: difficultyData }] =
    await Promise.all([
      supabase
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .then((r) => ({ data: r.count })),
      supabase.rpc("admin_platform_summary"),
      supabase.rpc("question_difficulty_report", { p_limit: 5 }),
    ]);

  const s = summaryData as PlatformSummary | null;
  const missed = (difficultyData ?? []) as DifficultQuestion[];

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Overview</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/students?status=pending">
          <Tile value={pendingCount ?? 0} label="Pending approvals" />
        </Link>
        <Link href="/admin/students">
          <Tile value={s?.active_students ?? 0} label="Active students" />
        </Link>
        <Tile value={s?.tests_this_month ?? 0} label="Tests this month" />
        <Tile value={s?.total_attempts ?? 0} label="Total attempts" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile value={`${s?.average_score_pct ?? 0}%`} label="Average score" />
        <Tile value={`${s?.participation_pct ?? 0}%`} label="Participation rate" />
        <Tile value={s?.best_subject ?? "—"} label="Highest-performing subject" small />
        <Tile value={s?.hardest_topic ?? "—"} label="Most difficult topic" small />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most missed questions</CardTitle>
          <CardDescription>
            Lowest correctness across tests and practice (minimum 3 attempts)
          </CardDescription>
        </CardHeader>
        <div className="grid gap-1 px-6 pb-6">
          {missed.map((q) => (
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
          {missed.length === 0 && (
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
