import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { getAdminSubscriptionPermissions } from "@/lib/subscriptions/admin-permissions";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { formatDateTime } from "@/lib/utils";
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
import {
  ADMIN_SUBSCRIPTION_SEARCH_STUDENT_LIMIT,
  adminStudentNameEmailOrFilter,
  adminSubscriptionStudentScope,
  normalizeAdminStudentSearchTerm,
} from "@/lib/subscriptions/admin-list-query";
import { ApplicationActions } from "../application-actions";

export const metadata = { title: "Subscription applications — MedVerse Admin" };

type ProfileJoin = { full_name: string | null; email: string | null };

export default async function AdminApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminSubscriptionPermissions();
  if (!perms.reviewApplications) {
    return <AdminPermissionDenied title="Subscription applications" />;
  }
  const { status, q, year: searchYear } = await searchParams;
  const filter = status ?? "pending";

  return requireAdminClass({
    searchYear,
    next: "/admin/subscriptions/applications",
    children: async (year) => {
      const term = normalizeAdminStudentSearchTerm(q);
      let matchedStudentIds: string[] | null = null;
      if (term) {
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "student")
          .or(adminStudentNameEmailOrFilter(term))
          .limit(ADMIN_SUBSCRIPTION_SEARCH_STUDENT_LIMIT);
        matchedStudentIds = (matchedProfiles ?? []).map((p) => p.id as string);
      }
      const studentScope = adminSubscriptionStudentScope({
        searchTerm: term,
        matchedStudentIds,
      });

      let query =
        studentScope.kind === "empty"
          ? null
          : supabase
              .from("subscription_applications")
              .select(
                "id, status, amount, currency, created_at, reviewed_at, review_note, student_id, plan_id, year_id, profiles!subscription_applications_student_id_fkey(full_name, email), subscription_plans(name)"
              )
              .eq("year_id", year.id)
              .order("created_at", { ascending: false })
              .limit(studentScope.limit);

      if (query && studentScope.kind === "byIds") {
        query = query.in("student_id", studentScope.studentIds);
      }
      if (query && filter && filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data, error } = query
        ? await query
        : { data: [] as never[], error: null };
      const rows = data ?? [];
      const yearQuery = `year=${encodeURIComponent(year.id)}`;

      return (
        <div className="grid gap-6">
          <div>
            <h1 className="text-2xl font-semibold">Subscription applications</h1>
            <p className="text-sm text-muted-foreground">
              Scoped to {year.name}. Screenshots open via authorized short-lived
              access only — never a public R2 URL.
            </p>
          </div>

          <SubscriptionAdminNav currentPath="/admin/subscriptions/applications" />

          {!perms.canApprove && (
            <p className="text-sm text-muted-foreground">
              Review actions require <code>review_subscription_applications</code>.
              Approve also needs <code>manage_subscriptions</code>.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2 text-sm">
              {["pending", "approved", "rejected", "all"].map((s) => (
                <Link
                  key={s}
                  href={
                    s === "all"
                      ? `/admin/subscriptions/applications?status=all&${yearQuery}`
                      : `/admin/subscriptions/applications?status=${s}&${yearQuery}`
                  }
                  className={`rounded-md border px-3 py-1 ${
                    filter === s ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  {s}
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
              <input type="hidden" name="status" value={filter} />
              <input type="hidden" name="year" value={year.id} />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
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
                  <TableHead>Student</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const p = a.profiles as unknown as ProfileJoin | null;
                  const plan = a.subscription_plans as unknown as {
                    name: string;
                  } | null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link
                          href={`/admin/students/${a.student_id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {p?.full_name || "—"}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {p?.email}
                        </div>
                      </TableCell>
                      <TableCell>{plan?.name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {a.amount} {a.currency}
                      </TableCell>
                      <TableCell>
                        <Badge variant={subStatusVariant[a.status] ?? "outline"}>
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(a.created_at)}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground">
                        {a.review_note || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <ApplicationActions
                          applicationId={a.id}
                          status={a.status}
                          canApprove={perms.canApprove}
                          canReview={perms.reviewApplications}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      No applications match for this class.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      );
    },
  });
}
