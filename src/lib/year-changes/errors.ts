/**
 * Map RPC / transport errors for year-change UI.
 * Prefer stable exception tokens; never invent success on unknown errors.
 */
const MESSAGES: Record<string, string> = {
  permission_denied: "You do not have permission for this action.",
  "admin only": "You do not have permission for this action.",
  not_authenticated: "Your session expired. Sign in again.",
  account_not_eligible: "Your account cannot submit year-change requests right now.",
  no_active_enrollment: "You need an active class enrollment first.",
  year_not_found: "That academic year was not found.",
  same_year: "Choose a different year than your current enrollment.",
  year_change_already_pending: "You already have a pending year-change request.",
  year_change_not_found: "That year-change request was not found.",
  year_change_not_pending: "Only pending requests can be reviewed or edited.",
  year_change_request_rpc_only: "That change is not allowed.",
};

export function yearChangeErrorMessage(
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

export type YearChangeStatus = "pending" | "approved" | "rejected";

export function yearChangeStatusLabel(status: string): string {
  if (status === "pending") return "Pending review";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return status;
}

export function canStudentSubmitYearChange(input: {
  hasActiveEnrollment: boolean;
  hasPendingRequest: boolean;
}): boolean {
  return input.hasActiveEnrollment && !input.hasPendingRequest;
}
