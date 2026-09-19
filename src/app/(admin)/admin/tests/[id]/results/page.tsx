import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import {
  adminHasAny,
  getAdminPermissionSet,
} from "@/lib/admin/admin-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Test results — MedVerse Admin" };

type LeaderRow = {
  rank: number | null;
  percentile: number | null;
  student_id: string;
  full_name: string;
  score: number;
  max_score: number;
  percentage: number;
  is_me: boolean;
};

export default async function TestResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminPermissionSet();
  const canViewNames = adminHasAny(perms, ["view_students"]);
  const { id } = await params;

  const { data: test } = await supabase
    .from("tests")
    .select("id, title, status")
    .eq("id", id)
    .maybeSingle();
  if (!test) notFound();

  const [{ data: summary }, { data: leaderboard }, { data: attempts }] =
    await Promise.all([
      supabase.rpc("test_summary", { p_test_id: id }),
      supabase.rpc("test_leaderboard", { p_test_id: id }),
      canViewNames
        ? supabase
            .from("test_attempts")
            .select(
              "id, student_id, state, invalidated_reason, profiles(full_name, email)"
            )
            .eq("test_id", id)
            .eq("state", "in_progress")
        : supabase
            .from("test_attempts")
            .select("id, student_id, state")
            .eq("test_id", id)
            .eq("state", "in_progress"),
    ]);

  const s = summary as {
    registered: number;
    attempted: number;
    completed: number;
    average_score: number;
    median_score: number;
    highest_score: number;
    lowest_score: number;
  } | null;

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{test.title} — Results</h1>
        <Badge>{test.status}</Badge>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/tests/${id}`}>Back to test</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Registered" value={String(s?.registered ?? 0)} />
        <Stat label="Attempted" value={String(s?.attempted ?? 0)} />
        <Stat label="Completed" value={String(s?.completed ?? 0)} />
        <Stat
          label="Average"
          value={s ? `${s.average_score} (${s.median_score} median)` : "—"}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:w-1/2">
        <Stat label="Highest score" value={String(s?.highest_score ?? "—")} />
        <Stat label="Lowest score" value={String(s?.lowest_score ?? "—")} />
      </div>

      {(attempts ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Currently in progress</CardTitle>
            <CardDescription>
              Students still taking the test right now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {(attempts ?? []).map((a) => {
                const row = a as {
                  id: string;
                  student_id: string;
                  profiles?: { full_name: string } | null;
                };
                if (canViewNames) {
                  return (
                    <li key={row.id}>
                      {row.profiles?.full_name ?? row.student_id}
                    </li>
                  );
                }
                return (
                  <li key={row.id}>
                    In progress ({String(row.student_id).slice(0, 8)}…)
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Percentage</TableHead>
                <TableHead>Percentile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {((leaderboard ?? []) as LeaderRow[]).map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell>#{r.rank}</TableCell>
                  <TableCell>{r.full_name}</TableCell>
                  <TableCell>
                    {r.score} / {r.max_score}
                  </TableCell>
                  <TableCell>{r.percentage}%</TableCell>
                  <TableCell>
                    {r.percentile != null ? r.percentile : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(leaderboard ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No submissions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
