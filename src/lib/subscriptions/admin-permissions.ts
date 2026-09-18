import { createClient } from "@/lib/supabase/server";
import {
  buildAdminSubPermissions,
  type AdminSubPermissions,
} from "@/lib/subscriptions/admin-errors";

/** UX-only permission snapshot. RPCs remain authoritative. */
export async function getAdminSubscriptionPermissions(): Promise<AdminSubPermissions> {
  const supabase = await createClient();
  const [manage, review, payment] = await Promise.all([
    supabase.rpc("has_permission", { p_code: "manage_subscriptions" }),
    supabase.rpc("has_permission", {
      p_code: "review_subscription_applications",
    }),
    supabase.rpc("has_permission", { p_code: "manage_payment_settings" }),
  ]);
  return buildAdminSubPermissions({
    manageSubscriptions: Boolean(manage.data),
    reviewApplications: Boolean(review.data),
    managePaymentSettings: Boolean(payment.data),
  });
}
