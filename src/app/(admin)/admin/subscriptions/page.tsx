import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { getAdminSubscriptionPermissions } from "@/lib/subscriptions/admin-permissions";
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

export const metadata = { title: "Subscriptions — MedVerse Admin" };

type ProfileJoin = {
  full_name: string | null;
  email: string | null;
  account_status: string | null;
};

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminSubscriptionPermissions();
  const { status, q } = await searchParams;

  const [{ data: subs, error }, { data: plans }, { data: enrollments }] =
    await Promise.all([
      supabase
        .from("subscriptions")
        .select(
          "id, status, starts_at, ends_at, grace_days, paid_access_mode, student_id, plan_id, profiles!subscriptions_student_id_fkey(full_name, email, account_status), subscription_plans(name)"
        )
        .order("ends_at", { ascending: false })
        .limit(300),
      supabase
        .from("subscription_plans")
        .select("id, name, duration_days, is_active")
        .order("sort_order")
        .order("name"),
      supabase
        .from("enrollments")
        .select(
          "student_id, status, profiles!enrollments_student_id_fkey(full_name, email, account_status, role)"
        )
        .eq("status", "active")
        .limit(300),
    ]);

  const nowIso = new Date().toISOString();
  const term = q?.toLowerCase().trim();
  const rows = (subs ?? [])
    .map((s) => {
      const profile = s.profiles as unknown as ProfileJoin | null;
      const plan = s.subscription_plans as unknown as { name: string } | null;
      const isLive = subscriptionIsLiveAt(
        s.status,
        s.ends_at,
        s.grace_days ?? 0
      );
      let displayStatus = s.status;
      if (s.status === "active" && !isLive) displayStatus = "expired";
      else if (
        s.status === "active" &&
        isLive &&
        s.ends_at <= nowIso
      )
        displayStatus = "grace";
      return { s, profile, plan, isLive, displayStatus };
    })
    .filter((r) => {
      if (status === "active" && !r.isLive) return false;
      if (status === "expired" && r.displayStatus !== "expired") return false;
      if (status === "deactivated" && r.s.status !== "deactivated") return false;
      if (!term) return true;
      return (
        r.profile?.full_name?.toLowerCase().includes(term) ||
        r.profile?.email?.toLowerCase().includes(term)
      );
    });

  const activePlans = (plans ?? []).filter((p) => p.is_active);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            Account status and subscription status are separate. Restricting an
            account does not change subscription rows.
          </p>
        </div>
      </div>

      <SubscriptionAdminNav currentPath="/admin/subscriptions" />

      {!perms.manageSubscriptions && (
        <p className="text-sm text-muted-foreground">
          You can view this list. Lifecycle actions require{" "}
          <code>manage_subscriptions</code>.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 text-sm">
          {["", "active", "expired", "deactivated"].map((s) => (
            <Link
              key={s || "all"}
              href={
                s
                  ? `/admin/subscriptions?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`
                  : `/admin/subscriptions${q ? `?q=${encodeURIComponent(q)}` : ""}`
              }
              className={`rounded-md border px-3 py-1 ${
                (status ?? "") === s ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              {s || "all"}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          <Input
            name="q"
            placeholder="Search student…"
            defaultValue={q ?? ""}
            className="w-56"
          />
          {status && <input type="hidden" name="status" value={status} />}
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
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
            {rows.map(({ s, profile, plan, isLive, displayStatus }) => (
              <TableRow key={s.id}>
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
                  <Badge variant={subStatusVariant[displayStatus] ?? "outline"}>
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
                <TableCell colSpan={7} className="text-muted-foreground">
                  No subscriptions match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {(() => {
        const liveStudentIds = new Set(
          (subs ?? [])
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
              Active enrollments without a live subscription
            </h2>
            <div className="overflow-x-auto rounded-md border">
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
                          accountStatus={profile?.account_status ?? "active"}
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
}
