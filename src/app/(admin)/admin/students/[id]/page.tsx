import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Student profile — MedVerse Admin" };

type Profile = {
  profile: { full_name: string; email: string; last_login_at: string | null };
  enrollment: { status: string; year_id: string; year_name: string } | null;
  performance: {
    tests_taken: number;
    average_percentage: number;
    highest_percentage: number;
    last_test_at: string | null;
  };
  subject_access: { subject_id: string; subject_name: string; practice_granted: boolean }[];
};

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;

  const [{ data }, { data: recentTests }] = await Promise.all([
    supabase.rpc("admin_student_profile", { p_student_id: id }),
    supabase
      .from("test_attempts")
      .select("id, test_id, score, max_score, percentage, rank, submitted_at, tests(title)")
      .eq("student_id", id)
      .eq("state", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(10),
  ]);

  const p = data as Profile | null;
  if (!p || !p.profile) notFound();

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{p.profile.full_name}</h1>
          <p className="text-muted-foreground">{p.profile.email}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/students">Back to students</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Status">
              <Badge>{p.enrollment?.status ?? "no enrollment"}</Badge>
            </Row>
            <Row label="Year">{p.enrollment?.year_name ?? "—"}</Row>
            <Row label="Last login">
              {p.profile.last_login_at
                ? new Date(p.profile.last_login_at).toLocaleString()
                : "Never"}
            </Row>
            <Row label="Last test">
              {p.performance.last_test_at
                ? new Date(p.performance.last_test_at).toLocaleString()
                : "Never"}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Access</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {p.subject_access.map((a) => (
              <div key={a.subject_id} className="flex items-center justify-between">
                <span>{a.subject_name}</span>
                <span>{a.practice_granted ? "✓" : "✗"}</span>
              </div>
            ))}
            {p.subject_access.length === 0 && (
              <p className="text-muted-foreground">No enrollment yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <Stat label="Tests" value={String(p.performance.tests_taken)} />
          <Stat label="Average" value={`${p.performance.average_percentage}%`} />
          <Stat label="Highest" value={`${p.performance.highest_percentage}%`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(recentTests ?? []).map((t) => {
            const test = t.tests as unknown as { title: string } | null;
            return (
              <Link
                key={t.id}
                href={`/admin/tests/${t.test_id}/results`}
                className="flex items-center justify-between rounded-md border p-2 text-sm transition-colors hover:bg-accent/50"
              >
                <span>{test?.title}</span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>
                    {t.score}/{t.max_score} ({t.percentage}%)
                  </span>
                  {t.rank != null && <span>Rank #{t.rank}</span>}
                </div>
              </Link>
            );
          })}
          {(recentTests ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No tests taken yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3 text-center">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}
