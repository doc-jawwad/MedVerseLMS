import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StudentManageActions } from "../student-actions";
import {
  accountStatusBadgeVariant,
  accountStatusLabel,
  enrollmentClassLabel,
  pickLiveEnrollment,
  yearNameFromEnrollment,
} from "@/lib/admin/student-account-ui";

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

  const [
    { data },
    { data: recentTests },
    { data: accountRow },
    { count: liveExamCount },
    { data: enrollmentRows },
  ] =
    await Promise.all([
      supabase.rpc("admin_student_profile", { p_student_id: id }),
      supabase
        .from("test_attempts")
        .select("id, test_id, score, max_score, percentage, rank, submitted_at, tests(title)")
        .eq("student_id", id)
        .eq("state", "submitted")
        .order("submitted_at", { ascending: false })
        .limit(10),
      supabase
        .from("profiles")
        .select("account_status")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("test_attempts")
        .select("id", { count: "exact", head: true })
        .eq("student_id", id)
        .eq("state", "in_progress")
        .then((r) => ({ count: r.count })),
      supabase
        .from("enrollments")
        .select("id, status, year_id, years(name)")
        .eq("student_id", id),
    ]);

  const p = data as Profile | null;
  if (!p || !p.profile) notFound();
  const accountStatus =
    (accountRow?.account_status as string | undefined) ?? "active";
  const liveClass = pickLiveEnrollment(
    (enrollmentRows ?? []) as {
      id: string;
      status: string;
      year_id: string;
      years?: { name?: string | null } | null;
    }[]
  );
  const classYear =
    liveClass
      ? yearNameFromEnrollment(liveClass)
      : (p.enrollment?.year_name ?? "—");
  const classStatus = liveClass?.status ?? p.enrollment?.status ?? null;
  const hasActiveClass = Boolean(liveClass);
  const hasInProgressExam = (liveExamCount ?? 0) > 0;
  const yearId = liveClass?.year_id ?? p.enrollment?.year_id ?? null;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{p.profile.full_name}</h1>
          <p className="text-muted-foreground">{p.profile.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <StudentManageActions
            studentId={id}
            yearId={yearId}
            hasActiveClass={hasActiveClass}
            accountStatus={accountStatus}
            hasInProgressExam={hasInProgressExam}
          />
          <Button asChild variant="outline">
            <Link href="/admin/students">Back to students</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="LMS access">
              <Badge variant={accountStatusBadgeVariant(accountStatus)}>
                {accountStatusLabel(accountStatus)}
              </Badge>
            </Row>
            {hasInProgressExam && (
              <Row label="Open exam">
                <span>In progress</span>
              </Row>
            )}
            <Row label="Last login">
              {p.profile.last_login_at
                ? formatDateTime(p.profile.last_login_at)
                : "Never"}
            </Row>
            <Row label="Last test">
              {p.performance.last_test_at
                ? formatDateTime(p.performance.last_test_at)
                : "Never"}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Class</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Year">{classYear}</Row>
            <Row label="Class status">
              <Badge variant="outline">
                {enrollmentClassLabel(classStatus)}
              </Badge>
            </Row>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Practice grants</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
            {p.subject_access.map((a) => (
              <div key={a.subject_id} className="flex items-center justify-between">
                <span>{a.subject_name}</span>
                <span>{a.practice_granted ? "✓" : "✗"}</span>
              </div>
            ))}
            {p.subject_access.length === 0 && (
              <p className="text-muted-foreground">
                {hasActiveClass
                  ? "No practice grants recorded for the current class."
                  : "No current class assigned."}
              </p>
            )}
          </CardContent>
        </Card>

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
