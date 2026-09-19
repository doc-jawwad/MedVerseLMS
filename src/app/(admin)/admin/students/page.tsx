import { requireAdmin } from "@/lib/auth/require-user";
import {
  adminHasAny,
  getAdminPermissionSet,
} from "@/lib/admin/admin-nav";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StudentManageActions } from "./student-actions";
import Link from "next/link";
import {
  ACCOUNT_FILTERS,
  accountStatusBadgeVariant,
  accountStatusLabel,
  enrollmentClassLabel,
  matchesAccountFilter,
  pickLiveEnrollment,
  yearNameFromEnrollment,
  type EnrollmentRow,
} from "@/lib/admin/student-account-ui";

export const metadata = { title: "Students — MedVerse Admin" };

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  account_status: string | null;
  last_login_at: string | null;
  created_at: string;
  enrollments: EnrollmentRow[] | null;
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; account?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminPermissionSet();
  if (
    !adminHasAny(perms, [
      "view_students",
      "manage_students",
      "activate_students",
      "restrict_students",
    ])
  ) {
    return <AdminPermissionDenied title="Students" />;
  }
  const { q, account } = await searchParams;

  const [{ data: profiles, error }, { data: liveAttempts }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, email, account_status, last_login_at, created_at, enrollments(id, status, year_id, years(name))"
      )
      .eq("role", "student")
      .order("full_name", { ascending: true })
      .limit(200),
    supabase
      .from("test_attempts")
      .select("student_id")
      .eq("state", "in_progress"),
  ]);

  const inProgress = new Set(
    (liveAttempts ?? []).map((a) => a.student_id as string)
  );

  const term = q?.toLowerCase().trim();
  const rows = ((profiles ?? []) as ProfileRow[]).filter((p) => {
    if (!matchesAccountFilter(p.account_status, account)) return false;
    if (!term) return true;
    return (
      p.full_name?.toLowerCase().includes(term) ||
      p.email?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Students</h1>
        <form className="flex gap-2">
          <Input
            name="q"
            placeholder="Search name or email…"
            defaultValue={q ?? ""}
            className="w-64"
          />
          {account && <input type="hidden" name="account" value={account} />}
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {ACCOUNT_FILTERS.map((s) => (
          <Link
            key={s.id || "all"}
            href={s.id ? `/admin/students?account=${s.id}` : "/admin/students"}
            className={`rounded-md border px-3 py-1 ${
              (account ?? "") === s.id ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">Could not load this page. Please try again.</p>}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>LMS access</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No students found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => {
              const live = pickLiveEnrollment(p.enrollments);
              const classYear = yearNameFromEnrollment(live);
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/students/${p.id}`} className="hover:underline">
                      {p.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.email}</TableCell>
                  <TableCell>
                    <div>{classYear}</div>
                    <div className="text-xs text-muted-foreground">
                      {enrollmentClassLabel(live?.status ?? null)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={accountStatusBadgeVariant(p.account_status)}>
                      {accountStatusLabel(p.account_status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(p.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <StudentManageActions
                      studentId={p.id}
                      yearId={live?.year_id ?? p.enrollments?.[0]?.year_id ?? null}
                      hasActiveClass={Boolean(live)}
                      accountStatus={p.account_status ?? "active"}
                      hasInProgressExam={inProgress.has(p.id)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
