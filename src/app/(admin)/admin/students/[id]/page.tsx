import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import {
  adminHasAny,
  getAdminPermissionSet,
} from "@/lib/admin/admin-nav";
import { createAdminStudentDetailAdapter } from "@/lib/admin/student-360/adapter";
import {
  classLockBadgeLabel,
  classLockHeadline,
} from "@/lib/profile/presentation";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StudentManageActions } from "../student-actions";
import {
  accountStatusBadgeVariant,
  accountStatusLabel,
  enrollmentClassLabel,
} from "@/lib/admin/student-account-ui";

export const metadata = { title: "Student 360 — MedVerse Admin" };

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const perms = await getAdminPermissionSet();
  if (
    !adminHasAny(perms, [
      "view_students",
      "manage_students",
      "activate_students",
      "restrict_students",
      "view_analytics",
      "manage_subscriptions",
      "review_subscription_applications",
    ])
  ) {
    return <AdminPermissionDenied title="Student 360" />;
  }
  const { id } = await params;
  const adapter = createAdminStudentDetailAdapter();
  const result = await adapter.getStudentDetail(id);
  if (!result.ok) {
    if (result.notFound) notFound();
    return <AdminPermissionDenied title="Student 360" />;
  }

  const d = result.data;
  const sections = new Set(d.visible_sections);
  const yearId = d.class.year_id;
  const hasActiveClass = Boolean(
    d.class.enrollment_status === "active" ||
      d.class.enrollment_status === "pending"
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-[#072855]/10 text-lg font-semibold text-[#072855]">
            {d.biodata.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={d.biodata.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              d.biodata.full_name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? "")
                .join("") || "?"
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Student 360
            </p>
            <h1 className="text-2xl font-semibold text-[#072855]">
              {d.biodata.full_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {d.class.year_name ?? "No class"} ·{" "}
              {accountStatusLabel(d.biodata.account_status)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Leaderboard-safe identity: name, college
              {d.public_identity.college_name
                ? ` (${d.public_identity.college_name})`
                : ""}
              , avatar — never phone, email, or payment.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {adminHasAny(perms, [
            "manage_students",
            "activate_students",
            "restrict_students",
            "grant_resource_access",
            "manage_year_changes",
          ]) && (
            <StudentManageActions
              studentId={id}
              yearId={yearId}
              hasActiveClass={hasActiveClass}
              accountStatus={d.biodata.account_status}
              hasInProgressExam={d.has_in_progress_exam}
            />
          )}
          <Button asChild variant="outline">
            <Link href="/admin/students">Back to students</Link>
          </Button>
        </div>
      </div>

      {sections.has("biodata") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Biodata & contact</CardTitle>
            <CardDescription>
              Private to admins with student permissions. Not visible to other
              students.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="Name">{d.biodata.full_name}</Row>
            <Row label="Email">{d.biodata.email}</Row>
            <Row label="Contact">{d.biodata.contact_number ?? "—"}</Row>
            <Row label="College">{d.biodata.college_name ?? "—"}</Row>
            <Row label="LMS access">
              <Badge
                variant={accountStatusBadgeVariant(d.biodata.account_status)}
              >
                {accountStatusLabel(d.biodata.account_status)}
              </Badge>
            </Row>
            <Row label="Last login">
              {d.biodata.last_login_at
                ? formatDateTime(d.biodata.last_login_at)
                : "Never"}
            </Row>
            {d.has_in_progress_exam && (
              <Row label="Open exam">
                <span>In progress</span>
              </Row>
            )}
          </CardContent>
        </Card>
      )}

      {sections.has("class") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Class</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="rounded-md border border-[#072855]/15 bg-[#072855]/[0.03] p-3">
              <Badge variant="outline">
                {classLockBadgeLabel(d.class.lock.lock)}
              </Badge>
              <p className="mt-2 font-medium text-[#072855]">
                {classLockHeadline(d.class.lock)}
              </p>
            </div>
            <Row label="Year">{d.class.year_name ?? "—"}</Row>
            <Row label="Class status">
              <Badge variant="outline">
                {enrollmentClassLabel(d.class.enrollment_status)}
              </Badge>
            </Row>
          </CardContent>
        </Card>
      )}

      {sections.has("subscription") && d.subscription && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="Status">{d.subscription.status_label}</Row>
            <Row label="Live access">
              {d.subscription.has_live ? "Yes" : "No"}
            </Row>
            <Row label="Plan">{d.subscription.plan_name ?? "—"}</Row>
            <Row label="Purchased class">
              {d.subscription.year_name ?? "—"}
            </Row>
            <Row label="Starts">
              {d.subscription.starts_at
                ? formatDate(d.subscription.starts_at)
                : "—"}
            </Row>
            <Row label="Ends">
              {d.subscription.ends_at
                ? formatDate(d.subscription.ends_at)
                : "—"}
            </Row>
            {d.subscription.pending_application_id && (
              <Row label="Pending amount">
                {d.subscription.pending_amount != null
                  ? `${d.subscription.pending_amount} ${d.subscription.pending_currency ?? ""}`
                  : "—"}
              </Row>
            )}
            <div className="sm:col-span-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/subscriptions">Open subscriptions</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {sections.has("analytics") && d.analytics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Analytics / stats</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="Tests" value={String(d.analytics.tests_taken)} />
            <Stat
              label="Average"
              value={`${d.analytics.average_percentage}%`}
            />
            <Stat
              label="Highest"
              value={`${d.analytics.highest_percentage}%`}
            />
            <Stat
              label="Last test"
              value={
                d.analytics.last_test_at
                  ? formatDate(d.analytics.last_test_at)
                  : "—"
              }
            />
          </CardContent>
        </Card>
      )}

      {sections.has("practice") && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Practice performance</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Stat
                label="Answers"
                value={String(d.practice?.answers_count ?? 0)}
              />
              <Stat
                label="Correct"
                value={String(d.practice?.correct_count ?? 0)}
              />
              <Stat
                label="Accuracy"
                value={
                  d.practice?.accuracy_percent != null
                    ? `${d.practice.accuracy_percent}%`
                    : "—"
                }
              />
              <Stat
                label="Subjects"
                value={String(d.practice?.subjects_practiced ?? 0)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Practice grants</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {d.practice_grants.map((a) => (
                <div
                  key={a.subject_id}
                  className="flex items-center justify-between"
                >
                  <span>{a.subject_name}</span>
                  <span>{a.granted ? "Granted" : "—"}</span>
                </div>
              ))}
              {d.practice_grants.length === 0 && (
                <p className="text-muted-foreground">
                  {hasActiveClass
                    ? "No practice grants recorded for the current class."
                    : "No current class assigned."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {sections.has("test_history") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test history</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {d.test_history.map((t) => (
              <Link
                key={t.attempt_id}
                href={`/admin/tests/${t.test_id}/results`}
                className="flex items-center justify-between rounded-md border p-2 text-sm transition-colors hover:bg-accent/50"
              >
                <div className="grid gap-0.5">
                  <span>{t.test_title}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.state}
                    {t.submitted_at
                      ? ` · ${formatDateTime(t.submitted_at)}`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {t.percentage != null && (
                    <span>
                      {t.score}/{t.max_score} ({t.percentage}%)
                    </span>
                  )}
                  {t.rank != null && <span>Rank #{t.rank}</span>}
                </div>
              </Link>
            ))}
            {d.test_history.length === 0 && (
              <p className="text-sm text-muted-foreground">No tests yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {sections.has("payment_history") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
            <CardDescription>
              Applications and subscriptions. Never shown to other students.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {d.payment_history.map((p) => (
              <div
                key={`${p.kind}-${p.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <div className="grid gap-0.5">
                  <span className="font-medium">
                    {p.kind === "application"
                      ? "Application"
                      : p.plan_name ?? "Subscription"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(p.created_at)}
                    {p.review_note ? ` · ${p.review_note}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {p.amount != null && (
                    <span>
                      {p.amount} {p.currency}
                    </span>
                  )}
                  <Badge variant="outline">{p.status}</Badge>
                </div>
              </div>
            ))}
            {d.payment_history.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No payment records.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3 text-center">
      <p className="text-2xl font-semibold text-[#072855]">{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}
