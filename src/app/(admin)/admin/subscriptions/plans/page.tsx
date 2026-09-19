import { requireAdmin } from "@/lib/auth/require-user";
import { getAdminSubscriptionPermissions } from "@/lib/subscriptions/admin-permissions";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { SubscriptionAdminNav } from "@/components/admin/subscription-admin-nav";
import { PlanManager, type PlanRow } from "./plan-manager";

export const metadata = { title: "Subscription plans — MedVerse Admin" };

export default async function AdminPlansPage() {
  const { supabase } = await requireAdmin();
  const perms = await getAdminSubscriptionPermissions();
  if (!perms.manageSubscriptions && !perms.reviewApplications) {
    return <AdminPermissionDenied title="Subscription plans" />;
  }
  const { data, error } = await supabase
    .from("subscription_plans")
    .select(
      "id, name, description, duration_days, is_complimentary, is_active, sort_order"
    )
    .order("sort_order")
    .order("name");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Subscription plans</h1>
        <p className="text-sm text-muted-foreground">
          Activate/deactivate a plan with <code>update_subscription_plan</code>{" "}
          (<code>p_is_active</code>). Requires{" "}
          <code>manage_subscriptions</code>.
        </p>
      </div>
      <SubscriptionAdminNav currentPath="/admin/subscriptions/plans" />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {!perms.manageSubscriptions && (
        <p className="text-sm text-muted-foreground">
          View only — you lack <code>manage_subscriptions</code>.
        </p>
      )}
      <PlanManager
        plans={(data ?? []) as PlanRow[]}
        canManage={perms.manageSubscriptions}
      />
    </div>
  );
}
