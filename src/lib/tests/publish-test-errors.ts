/** Client-safe messages for draft → publish (docs/test-rules.md). */

const GENERIC = "Something went wrong. Please try again.";

const MESSAGES: Record<string, string> = {
  permission_denied: "You do not have permission to publish tests.",
  "admin only": "You do not have permission to publish tests.",
  "test not found": "That test was not found.",
  test_not_found: "That test was not found.",
  "only draft tests can be published":
    "Only draft tests can be published.",
};

/**
 * Map publish_test / validate_test RPC failures to admin-facing copy.
 * Preserves the existing `validation failed: <check>` style from the RPC.
 */
export function publishTestErrorMessage(
  code: string | null | undefined
): string {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return GENERIC;

  const lower = trimmed.toLowerCase();
  if (MESSAGES[lower]) return MESSAGES[lower];
  for (const [key, message] of Object.entries(MESSAGES)) {
    if (lower.includes(key)) return message;
  }

  // Existing publish_test style — checklist item name after the prefix.
  if (/^validation failed:\s+/i.test(trimmed)) {
    return trimmed;
  }

  return GENERIC;
}
