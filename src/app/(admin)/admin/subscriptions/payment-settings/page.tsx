import { requireAdmin } from "@/lib/auth/require-user";
import { getAdminSubscriptionPermissions } from "@/lib/subscriptions/admin-permissions";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { SubscriptionAdminNav } from "@/components/admin/subscription-admin-nav";
import {
  PaymentSettingsForm,
  type PaymentSettingsRow,
} from "./payment-settings-form";

export const metadata = { title: "Payment settings — MedVerse Admin" };

export default async function AdminPaymentSettingsPage() {
  const { supabase } = await requireAdmin();
  const perms = await getAdminSubscriptionPermissions();
  if (!perms.managePaymentSettings) {
    return <AdminPermissionDenied title="Payment settings" />;
  }
  const { data, error } = await supabase
    .from("payment_settings")
    .select(
      "bank_name, account_title, account_number, iban, payment_instructions, qr_reference, currency, is_active, subscription_grace_days"
    )
    .limit(1)
    .maybeSingle();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Payment settings</h1>
        <p className="text-sm text-muted-foreground">
          Students read these via <code>get_payment_instructions()</code>.
          Default currency is PKR.
        </p>
      </div>
      <SubscriptionAdminNav currentPath="/admin/subscriptions/payment-settings" />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      <PaymentSettingsForm
        initial={(data as PaymentSettingsRow | null) ?? null}
        canManage={perms.managePaymentSettings}
      />
    </div>
  );
}
