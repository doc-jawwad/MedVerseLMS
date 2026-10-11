/** Client-safe messages for return_to_draft_test / reuse_test_as_draft. */

const GENERIC = "Something went wrong. Please try again.";

const MESSAGES: Record<string, string> = {
  permission_denied: "You do not have permission to manage tests.",
  "admin only": "You do not have permission to manage tests.",
  test_not_found: "That test was not found.",
  test_not_published_unopened:
    "Only a published test that has not opened yet can be returned to draft.",
  test_already_open_or_unscheduled:
    "This test has already opened or has no opening time, so it cannot be returned to draft.",
  test_has_attempts:
    "This test already has attempt history and cannot be returned to draft.",
  test_not_reusable:
    "Only published or closed tests can be reused as a new draft.",
  test_window_not_closed:
    "Reuse is available only after the testing window has closed.",
};

export function lifecycleTestErrorMessage(
  code: string | null | undefined
): string {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return GENERIC;
  const lower = trimmed.toLowerCase();
  if (MESSAGES[lower]) return MESSAGES[lower];
  for (const [key, message] of Object.entries(MESSAGES)) {
    if (lower.includes(key)) return message;
  }
  return GENERIC;
}
