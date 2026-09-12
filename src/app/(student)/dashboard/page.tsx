import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Dashboard — MedVerse LMS" };

type RecentTest = {
  test_id: string;
  title: string;
  score: number;
  max_score: number;
  percentage: number;
  rank: number | null;
  submitted_at: string;
};

export default async function DashboardPage() {
  const { supabase, profile, enrollment } = await requireStudent();

  const now = new Date().toISOString();
  const [{ data: summary }, { data: recent }, { data: upcoming }, { data: myAttempts }] =
    await Promise.all([
      supabase.rpc("student_test_summary"),
      supabase.rpc("student_recent_tests", { p_limit: 5 }),
      supabase
        .from("tests")
        .select("id, title, subjects(name), duration_minutes, opens_at, closes_at, question_count")
        .eq("status", "published")
        .lte("opens_at", now)
        .gt("closes_at", now)
        .order("closes_at", { ascending: true })
        .limit(10),
      supabase
        .from("test_attempts")
        .select("test_id")
        .eq("student_id", profile.id)
        .neq("state", "invalidated"),
    ]);

  const attemptedIds = new Set((myAttempts ?? []).map((a) => a.test_id));
  const nextTest = (upcoming ?? []).find((t) => !attemptedIds.has(t.id));

  const s = summary as {
    tests_taken: number;
    average_percentage: number;
    best_percentage: number;
    average_rank: number;
  } | null;

  const subj = nextTest?.subjects as unknown as { name: string } | null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome, {profile.full_name || "Student"}
        </h1>
        <p className="text-muted-foreground">{enrollment.year_name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming test</CardTitle>
        </CardHeader>
        <CardContent>
          {nextTest ? (
            <div className="grid gap-2">
              <p className="font-medium">{nextTest.title}</p>
              <p className="text-sm text-muted-foreground">
                {subj?.name && `${subj.name} · `}
                {nextTest.question_count} MCQs · {nextTest.duration_minutes} minutes
              </p>
              <p className="text-sm text-muted-foreground">
                Available until{" "}
                {nextTest.closes_at && new Date(nextTest.closes_at).toLocaleString()}
              </p>
              <Button asChild className="w-fit">
                <Link href={`/tests/${nextTest.id}/attempt`}>Start test</Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing available right now.{" "}
              <Link href="/tests" className="underline">
                See all tests
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 font-medium text-muted-foreground">Performance</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Tests taken" value={String(s?.tests_taken ?? 0)} />
          <Stat label="Average score" value={`${s?.average_percentage ?? 0}%`} />
          <Stat label="Best score" value={`${s?.best_percentage ?? 0}%`} />
          <Stat
            label="Average rank"
            value={s?.average_rank ? `#${s.average_rank}` : "—"}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent tests</CardTitle>
          {(recent ?? []).length === 0 && (
            <CardDescription>No tests taken yet.</CardDescription>
          )}
        </CardHeader>
        {(recent ?? []).length > 0 && (
          <CardContent className="grid gap-2">
            {((recent ?? []) as RecentTest[]).map((r) => (
              <Link
                key={r.test_id}
                href={`/tests/${r.test_id}/result`}
                className="flex items-center justify-between rounded-md border p-2 text-sm transition-colors hover:bg-accent/50"
              >
                <span>{r.title}</span>
                <div className="flex items-center gap-2">
                  <Badge>{r.percentage}%</Badge>
                  {r.rank != null && (
                    <span className="text-muted-foreground">Rank #{r.rank}</span>
                  )}
                </div>
              </Link>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
