import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
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

  const { year: searchYear } = await searchParams;

  return requireAdminClass({
    searchYear,
    next: "/admin/subscriptions/plans",
    children: async (year) => {
      const [{ data: plans, error }, { data: years }] = await Promise.all([
        supabase
          .from("subscription_plans")
          .select(
            "id, name, description, duration_days, price, is_complimentary, is_active, sort_order, year_id, years(name, year_number)"
          )
          .eq("year_id", year.id)
          .order("sort_order")
          .order("name"),
        supabase
          .from("years")
          .select("id, name, year_number")
          .order("year_number"),
      ]);

      const planRows: PlanRow[] = (plans ?? []).map((p) => {
        const yr = p.years as unknown as {
          name: string;
          year_number: number;
        } | null;
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
          year_name: yr?.name ?? year.name,
        };
      });

      // PlanManager year picker: only years the caller can access (RLS + picker).
      const yearOptions: YearOption[] = (years ?? [])
        .filter((y) => y.id === year.id)
        .map((y) => ({
          id: y.id,
          year_name: y.name,
          year_number: y.year_number,
        }));

      return (
        <div className="grid gap-6">
          <div>
            <h1 className="text-2xl font-semibold">Subscription plans</h1>
            <p className="text-sm text-muted-foreground">
              Plans for {year.name}. Advertised price is display-only; the
              student-submitted transfer amount on applications is reviewed by
              admins and is not replaced by plan price.
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

          <PlanManager
            plans={planRows}
            years={yearOptions}
            canManage={perms.manageSubscriptions}
            filterYearId={year.id}
          />
        </div>
      );
    },
  });
}
