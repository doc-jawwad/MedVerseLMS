/** Client-safe messages for draft-test delete / edit gates. */

const MESSAGES: Record<string, string> = {
  permission_denied: "You do not have permission to manage tests.",
  "admin only": "You do not have permission to manage tests.",
  test_not_found: "That test was not found.",
  test_not_draft: "Only draft tests can be deleted.",
};

export function draftTestErrorMessage(code: string | null | undefined): string {
  const trimmed = (code ?? "").trim().toLowerCase();
  if (MESSAGES[trimmed]) return MESSAGES[trimmed];
  for (const [key, message] of Object.entries(MESSAGES)) {
    if (trimmed.includes(key)) return message;
  }
  return trimmed || "Something went wrong. Please try again.";
}
