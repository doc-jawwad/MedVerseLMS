import { requireAdmin } from "@/lib/auth/require-user";
import { getAdminSubscriptionPermissions } from "@/lib/subscriptions/admin-permissions";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { SubscriptionAdminNav } from "@/components/admin/subscription-admin-nav";
import { PlanManager, type PlanRow, type YearOption } from "./plan-manager";

export const metadata = { title: "Subscription plans — MedVerse Admin" };

export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminSubscriptionPermissions();
  if (!perms.manageSubscriptions && !perms.reviewApplications) {
    return <AdminPermissionDenied title="Subscription plans" />;
  }

  const { year: filterYearId } = await searchParams;

  const [{ data: plans, error }, { data: years }] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select(
        "id, name, description, duration_days, price, is_complimentary, is_active, sort_order, year_id, years(year_name, year_number)"
      )
      .order("year_id")
      .order("sort_order")
      .order("name"),
    supabase
      .from("years")
      .select("id, year_name, year_number")
      .order("year_number"),
  ]);

  const planRows: PlanRow[] = (plans ?? []).map((p) => {
    const yr = p.years as unknown as { year_name: string; year_number: number } | null;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      duration_days: p.duration_days,
      price: p.price ?? 0,
      is_complimentary: p.is_complimentary,
      is_active: p.is_active,
      sort_order: p.sort_order,
      year_id: p.year_id,
      year_name: yr?.year_name ?? null,
    };
  });

  const yearOptions: YearOption[] = (years ?? []).map((y) => ({
    id: y.id,
    year_name: y.year_name,
    year_number: y.year_number,
  }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Subscription plans</h1>
        <p className="text-sm text-muted-foreground">
          Each plan belongs to one class. Students see only active plans for
          their enrolled year. Price is read server-side at approval — never
          trusted from the client.
        </p>
      </div>
      <SubscriptionAdminNav currentPath="/admin/subscriptions/plans" />
      {error && (
        <p className="text-sm text-destructive">
          Could not load this page. Please try again.
        </p>
      )}
      {!perms.manageSubscriptions && (
        <p className="text-sm text-muted-foreground">
          View only — you lack <code>manage_subscriptions</code>.
        </p>
      )}

      {yearOptions.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href="/admin/subscriptions/plans"
            className={`rounded-md border px-3 py-1 ${!filterYearId ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            All classes
          </a>
          {yearOptions.map((y) => (
            <a
              key={y.id}
              href={`/admin/subscriptions/plans?year=${y.id}`}
              className={`rounded-md border px-3 py-1 ${filterYearId === y.id ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              {y.year_name}
            </a>
          ))}
        </div>
      )}

      <PlanManager
        plans={planRows}
        years={yearOptions}
        canManage={perms.manageSubscriptions}
        filterYearId={filterYearId ?? null}
      />
    </div>
  );
}
