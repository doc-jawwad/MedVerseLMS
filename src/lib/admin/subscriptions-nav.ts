/** Resolve Subscriptions nav landing so review/payment-only admins are not denied. */
export function subscriptionsNavHref(
  perms: ReadonlySet<string> | Iterable<string>
): string {
  const set = perms instanceof Set ? perms : new Set(perms);
  if (set.has("manage_subscriptions")) return "/admin/subscriptions";
  if (set.has("review_subscription_applications")) {
    return "/admin/subscriptions/applications";
  }
  if (set.has("manage_payment_settings")) {
    return "/admin/subscriptions/payment-settings";
  }
  return "/admin/subscriptions";
}
