import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { getAdminSubscriptionPermissions } from "@/lib/subscriptions/admin-permissions";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { formatDate, formatDateTime } from "@/lib/utils";
import { subscriptionIsLiveAt } from "@/lib/subscriptions/student-status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SubscriptionAdminNav,
  subStatusVariant,
} from "@/components/admin/subscription-admin-nav";
import { SubscriptionActions } from "./subscription-actions";
import {
  adminSubscriptionMonthOptions,
  adminSubscriptionsHref,
  formatYearMonthLabel,
  matchesAdminSubscriptionFilters,
  parseYearMonth,
  pktMonthUtcRange,
  serialNumber,
} from "@/lib/subscriptions/admin-list-query";

export const metadata = { title: "Subscriptions — MedVerse Admin" };

type ProfileJoin = {
  full_name: string | null;
  email: string | null;
  account_status: string | null;
};

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    year?: string;
    month?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminSubscriptionPermissions();
  if (!perms.manageSubscriptions) {
    return <AdminPermissionDenied title="Subscriptions" />;
  }
  const { status, q, year: searchYear, month: monthParam } = await searchParams;
  const selectedMonth = parseYearMonth(monthParam);

  return requireAdminClass({
    searchYear,
    next: "/admin/subscriptions",
    children: async (year) => {
      const monthRange = selectedMonth
        ? pktMonthUtcRange(selectedMonth.year, selectedMonth.month)
        : null;
      let subsQuery = supabase
        .from("subscriptions")
        .select(
          "id, status, starts_at, ends_at, grace_days, paid_access_mode, student_id, plan_id, year_id, profiles!subscriptions_student_id_fkey(full_name, email, account_status), subscription_plans(name)"
        )
        .eq("year_id", year.id)
        .order("ends_at", { ascending: false })
        .limit(300);
      if (monthRange) {
        subsQuery = subsQuery
          .gte("starts_at", monthRange.startIso)
          .lt("starts_at", monthRange.endIso);
      }

      const [{ data: subs, error }, { data: plans }, { data: enrollments }, { data: liveSubs }] =
        await Promise.all([
          subsQuery,
          supabase
            .from("subscription_plans")
            .select(
              "id, name, duration_days, is_active, year_id, is_complimentary"
            )
            .eq("year_id", year.id)
            .order("sort_order")
            .order("name"),
          supabase
            .from("enrollments")
            .select(
              "student_id, status, year_id, profiles!enrollments_student_id_fkey(full_name, email, account_status, role)"
            )
            .eq("status", "active")
            .eq("year_id", year.id)
            .limit(300),
          supabase
            .from("subscriptions")
            .select("student_id, status, ends_at, grace_days")
            .eq("year_id", year.id)
            .eq("status", "active")
            .limit(300),
        ]);

      const nowIso = new Date().toISOString();
      const term = q?.toLowerCase().trim();
      const rows = (subs ?? [])
        .map((s) => {
          const profile = s.profiles as unknown as ProfileJoin | null;
          const plan = s.subscription_plans as unknown as {
            name: string;
          } | null;
          const isLive = subscriptionIsLiveAt(
            s.status,
            s.ends_at,
            s.grace_days ?? 0
          );
          let displayStatus = s.status;
          if (s.status === "active" && !isLive) displayStatus = "expired";
          else if (s.status === "active" && isLive && s.ends_at <= nowIso)
            displayStatus = "grace";
          return { s, profile, plan, isLive, displayStatus };
        })
        .filter((r) =>
          matchesAdminSubscriptionFilters({
            statusFilter: status,
            searchTerm: term,
            isLive: r.isLive,
            displayStatus: r.displayStatus,
            rowStatus: r.s.status,
            fullName: r.profile?.full_name,
            email: r.profile?.email,
          })
        );

      const activePlans = (plans ?? []).filter((p) => p.is_active);
      const monthValue = selectedMonth
        ? `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, "0")}`
        : "";
      const monthOptions = adminSubscriptionMonthOptions(
        new Date(),
        monthParam
      );
      const hrefFor = (next: {
        status?: string;
        q?: string | null;
        month?: string | null;
      }) =>
        adminSubscriptionsHref({
          yearId: year.id,
          status: next.status !== undefined ? next.status : status,
          q: next.q !== undefined ? next.q : q,
          month: next.month !== undefined ? next.month : monthParam,
        });
      const monthLabel = selectedMonth
        ? formatYearMonthLabel(selectedMonth.year, selectedMonth.month)
        : null;

      return (
        <div className="grid gap-6">
          <div>
            <h1 className="text-2xl font-semibold">Subscriptions</h1>
            <p className="text-sm text-muted-foreground">
              Scoped to {year.name}. Account status and subscription status are
              separate.
            </p>
          </div>

          <SubscriptionAdminNav currentPath="/admin/subscriptions" />

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2 text-sm">
                {["", "active", "expired", "deactivated"].map((s) => (
                  <Link
                    key={s || "all"}
                    href={hrefFor({ status: s })}
                    className={`rounded-md border px-3 py-1 ${
                      (status ?? "") === s ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    {s || "all"}
                  </Link>
                ))}
              </div>
              <form className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:flex-none">
                  <span className="shrink-0 text-muted-foreground">Month</span>
                  <select
                    name="month"
                    defaultValue={monthValue}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm sm:w-48 sm:flex-none"
                  >
                    <option value="">All</option>
                    {monthOptions.map((value) => {
                      const parsed = parseYearMonth(value);
                      return (
                        <option key={value} value={value}>
                          {parsed
                            ? formatYearMonthLabel(parsed.year, parsed.month)
                            : value}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <Input
                  name="q"
                  placeholder="Search student…"
                  defaultValue={q ?? ""}
                  className="w-full sm:w-56"
                />
                <input type="hidden" name="year" value={year.id} />
                {status && <input type="hidden" name="status" value={status} />}
                <Button type="submit" variant="secondary">
                  Apply
                </Button>
              </form>
            </div>
            <p className="text-sm text-muted-foreground">
              {rows.length}{" "}
              {rows.length === 1 ? "subscription" : "subscriptions"}
              {monthLabel ? ` started in ${monthLabel}` : ""}
              {status || term ? " matching current filters" : ""}.
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">
              Could not load this page. Please try again.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ s, profile, plan, isLive, displayStatus }, index) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {serialNumber(index)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/students/${s.student_id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {profile?.full_name || "—"}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {profile?.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {profile?.account_status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{plan?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={subStatusVariant[displayStatus] ?? "outline"}
                      >
                        {displayStatus}
                        {isLive ? " · live" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(s.starts_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(s.ends_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <SubscriptionActions
                        subscriptionId={s.id}
                        studentId={s.student_id}
                        status={s.status}
                        isLive={isLive}
                        accountStatus={profile?.account_status ?? "active"}
                        canManage={perms.manageSubscriptions}
                        plans={activePlans}
                        graceDays={s.grace_days ?? 0}
                        paidAccessMode={s.paid_access_mode ?? "all_entitled"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground">
                      No subscriptions match for this class.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {(() => {
            const liveStudentIds = new Set(
              (liveSubs ?? [])
                .filter((s) =>
                  subscriptionIsLiveAt(s.status, s.ends_at, s.grace_days ?? 0)
                )
                .map((s) => s.student_id)
            );
            const nonActive = (enrollments ?? [])
              .map((e) => {
                const profile = e.profiles as unknown as (ProfileJoin & {
                  role?: string;
                }) | null;
                return { studentId: e.student_id as string, profile };
              })
              .filter(
                (e) =>
                  e.profile?.role !== "admin" &&
                  !liveStudentIds.has(e.studentId) &&
                  (!term ||
                    e.profile?.full_name?.toLowerCase().includes(term) ||
                    e.profile?.email?.toLowerCase().includes(term))
              )
              .slice(0, 50);

            if (nonActive.length === 0) return null;
            return (
              <div className="grid gap-3">
                <h2 className="font-medium text-muted-foreground">
                  Active enrollments in {year.name} without a live subscription
                </h2>
                <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {nonActive.map(({ studentId, profile }) => (
                        <TableRow key={studentId}>
                          <TableCell>
                            <Link
                              href={`/admin/students/${studentId}`}
                              className="font-medium underline-offset-2 hover:underline"
                            >
                              {profile?.full_name || "—"}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {profile?.email}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {profile?.account_status ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <SubscriptionActions
                              subscriptionId={null}
                              studentId={studentId}
                              status={null}
                              isLive={false}
                              accountStatus={
                                profile?.account_status ?? "active"
                              }
                              canManage={perms.manageSubscriptions}
                              plans={activePlans}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })()}
        </div>
      );
    },
  });
}
