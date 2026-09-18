/**
 * Map RPC / transport error codes to student-facing copy.
 * Never pass raw Postgres messages through to the UI.
 */
const MESSAGES: Record<string, string> = {
  not_authenticated: "Your session expired. Please sign in again.",
  account_not_eligible:
    "Your account cannot use payment or subscription features right now.",
  invalid_amount: "Enter a valid payment amount greater than zero.",
  application_already_pending:
    "You already have a pending application. Edit that one instead of creating another.",
  application_not_found: "That application could not be found.",
  application_not_pending:
    "This application can no longer be edited because it has already been reviewed.",
  invalid_screenshot_type:
    "Upload a JPEG, PNG, or WebP screenshot (other file types are not allowed).",
  invalid_screenshot_size:
    "The screenshot must be between 1 byte and 5 MB.",
  invalid_screenshot_object_key:
    "The payment screenshot could not be attached. Please try uploading again.",
  screenshot_access_denied:
    "You do not have access to that payment screenshot.",
  r2_not_configured:
    "Payment screenshot uploads are temporarily unavailable. Contact your academy admin.",
  plan_not_found: "No active subscription plan is available right now.",
  network_error:
    "Network error. Check your connection and try again.",
};

export function studentSubscriptionErrorMessage(
  codeOrMessage: string | null | undefined
): string {
  if (!codeOrMessage) {
    return "Something went wrong. Please try again.";
  }
  const trimmed = codeOrMessage.trim();
  if (MESSAGES[trimmed]) return MESSAGES[trimmed];

  // PostgREST / Postgres often wrap the raise text; match known tokens.
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (trimmed.includes(code)) return message;
  }

  if (/fetch failed|Failed to fetch|network/i.test(trimmed)) {
    return MESSAGES.network_error;
  }

  return "Something went wrong. Please try again.";
}
