import { DIRECTORY_PAGE_SIZE, normalizeDirectoryParams, directoryNamePattern, directoryHref } from "@/lib/admin/student-directory-params";
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
  pickLiveEnrollment,
  yearNameFromEnrollment,
  type EnrollmentRow,
} from "@/lib/admin/student-account-ui";

export const metadata = { title: "Students — MedVerse Admin" };

type ProfileRow = {
  id: string;
  full_name: string | null;
  account_status: string | null;
  created_at: string;
  enrollments: EnrollmentRow[] | null;
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; account?: string | string[]; page?: string | string[] }>;
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
  const { q, account, page, offset } = normalizeDirectoryParams(await searchParams);
  const canViewBiodata = perms.has("view_students");
  const emails = new Map<string, string | null>();
  let rows: ProfileRow[] = [];
  let hasNext = false;
  let loadError = false;

  const safeColumns =
    "id, full_name, account_status, created_at, enrollments!enrollments_student_id_fkey(id, status, year_id, years(name))";

  if (canViewBiodata) {
    const { data, error } = await supabase.rpc("admin_student_directory_search", {
      p_query: q,
      p_account: account,
      p_offset: offset,
    });
    loadError = Boolean(error);
    if (!error) {
      const matches = (data ?? []) as { id: string; email: string | null }[];
      hasNext = matches.length > DIRECTORY_PAGE_SIZE;
      const pageMatches = matches.slice(0, DIRECTORY_PAGE_SIZE);
      const ids = pageMatches.map((m) => m.id);
      if (ids.length > 0) {
        // Keep RLS as a second boundary for names, class rows and current status.
        const result = await supabase.from("profiles").select(safeColumns).eq("role", "student").in("id", ids);
        loadError = Boolean(result.error);
        const byId = new Map(((result.data ?? []) as ProfileRow[]).map((r) => [r.id, r]));
        for (const match of pageMatches) {
          const row = byId.get(match.id);
          if (row) {
            rows.push(row);
            emails.set(row.id, match.email);
          }
        }
      }
    }
  } else {
    // Non-biodata roles retain existing RLS and cannot search by private email.
    let query = supabase.from("profiles").select(safeColumns).eq("role", "student");
    if (account === "blocked") {
      query = query.in("account_status", ["restricted", "suspended", "deactivated", "revoked"]);
    } else if (account) {
      query = query.eq("account_status", account);
    }
    if (q) query = query.ilike("full_name", directoryNamePattern(q));
    const result = await query.order("full_name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }).range(offset, offset + DIRECTORY_PAGE_SIZE);
    loadError = Boolean(result.error);
    if (!result.error) {
      const matches = (result.data ?? []) as ProfileRow[];
      hasNext = matches.length > DIRECTORY_PAGE_SIZE;
      rows = matches.slice(0, DIRECTORY_PAGE_SIZE);
    }
  }

  // Do not scan every live exam for a single page.
  const ids = rows.map((r) => r.id);
  const { data: liveAttempts, error: attemptsError } = ids.length > 0
    ? await supabase.from("test_attempts").select("student_id").eq("state", "in_progress").in("student_id", ids)
    : { data: [], error: null };
  const inProgress = new Set((liveAttempts ?? []).map((a) => a.student_id as string));


  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Students</h1>
        <form className="flex gap-2">
          <Input
            name="q"
            placeholder={canViewBiodata ? "Search name or email…" : "Search name…"}
            defaultValue={q ?? ""}
            className="w-full min-w-0 sm:w-64"
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
            href={directoryHref(q, s.id, 1)}
            className={`rounded-md border px-3 py-1 ${
              (account ?? "") === s.id ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {loadError && <p className="text-sm text-destructive">Could not load this page. Please try again.</p>}

      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {canViewBiodata && <TableHead>Email</TableHead>}
              <TableHead>Class</TableHead>
              <TableHead>LMS access</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canViewBiodata ? 6 : 5} className="text-center text-muted-foreground">
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
                  {canViewBiodata && <TableCell>{emails.get(p.id) ?? "—"}</TableCell>}
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
                      hasInProgressExam={Boolean(attemptsError) || inProgress.has(p.id)}
                      permissions={[...perms]}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {!loadError && (
        <nav aria-label="Student directory pagination" className="flex items-center justify-between gap-2 text-sm">
          <span>Page {page} · {rows.length} students</span>
          <div className="flex gap-2">
            {page > 1 && <Button asChild variant="outline" size="sm"><Link href={directoryHref(q, account, page - 1)}>Previous</Link></Button>}
            {hasNext && page < 10000 && <Button asChild variant="outline" size="sm"><Link href={directoryHref(q, account, page + 1)}>Next</Link></Button>}
          </div>
        </nav>
      )}
    </div>
  );
}
