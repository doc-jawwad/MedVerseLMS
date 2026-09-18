import { revalidatePath } from "next/cache";

/** Shared cache invalidation for subscription admin + student surfaces. */
export function revalidateAdminSubscriptionPaths() {
  revalidatePath("/admin/subscriptions");
  revalidatePath("/admin/subscriptions/applications");
  revalidatePath("/admin/subscriptions/plans");
  revalidatePath("/admin/subscriptions/payment-settings");
  revalidatePath("/admin/students");
  revalidatePath("/subscription");
  revalidatePath("/dashboard");
  revalidatePath("/practice");
  revalidatePath("/tests");
  revalidatePath("/tests", "layout");
  revalidatePath("/materials");
  revalidatePath("/profile");
}
