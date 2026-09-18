/**
 * Map RPC / transport errors for admin subscription UI.
 * Prefer stable exception tokens; never invent success on unknown errors.
 */
const MESSAGES: Record<string, string> = {
  permission_denied: "You do not have permission for this action.",
  not_authenticated: "Your session expired. Sign in again.",
  plan_not_found: "That subscription plan was not found.",
  plan_name_required: "Plan name is required.",
  invalid_duration: "Duration must be a positive number of days.",
  subscription_not_found: "That subscription was not found.",
  subscription_not_active: "That subscription is not active.",
  subscription_not_live: "That subscription is not currently live.",
  application_not_found: "That application was not found.",
  application_not_pending: "Only pending applications can be reviewed or edited.",
  application_already_pending: "This student already has a pending application.",
  screenshot_access_denied: "You cannot view that payment screenshot.",
  r2_not_configured: "R2 is not configured for payment screenshots.",
  invalid_amount: "Enter a valid amount greater than zero.",
  account_not_eligible: "That account is not eligible for this action.",
  invalid_grace_days: "Grace period must be 0, 1, or 2 days.",
  invalid_paid_access_mode: "Paid access must be all entitled resources or grants only.",
  invalid_subscription_window: "The subscription start and end dates are not valid.",
  subscription_already_ended: "That subscription window has already ended.",
  subscription_already_active: "This student already has a live subscription.",
};

export function adminSubscriptionErrorMessage(
  codeOrMessage: string | null | undefined
): string {
  if (!codeOrMessage) return "Something went wrong. Please try again.";
  const trimmed = codeOrMessage.trim();
  if (MESSAGES[trimmed]) return MESSAGES[trimmed];
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (trimmed.includes(code)) return message;
  }
  return "Something went wrong. Please try again.";
}

export type AdminSubPermissions = {
  manageSubscriptions: boolean;
  reviewApplications: boolean;
  managePaymentSettings: boolean;
  canApprove: boolean;
};

export function buildAdminSubPermissions(input: {
  manageSubscriptions: boolean;
  reviewApplications: boolean;
  managePaymentSettings: boolean;
}): AdminSubPermissions {
  return {
    manageSubscriptions: input.manageSubscriptions,
    reviewApplications: input.reviewApplications,
    managePaymentSettings: input.managePaymentSettings,
    canApprove: input.manageSubscriptions && input.reviewApplications,
  };
}
