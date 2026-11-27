/** Client-safe messages for draft → publish (docs/test-rules.md). */

const GENERIC = "Something went wrong. Please try again.";
const CONCURRENT_RETRY =
  "Another change to this test was in progress — please retry.";

const MESSAGES: Record<string, string> = {
  permission_denied: "You do not have permission to publish tests.",
  "admin only": "You do not have permission to publish tests.",
  "test not found": "That test was not found.",
  test_not_found: "That test was not found.",
  "only draft tests can be published":
    "Only draft tests can be published.",
  test_question_year_mismatch:
    "Some questions belong to another class/year. Remove or replace them in the draft before publishing.",
  "deadlock detected": CONCURRENT_RETRY,
};

/**
 * Map year-change / concurrent-edit failures from question edits/moves and
 * test-config updates (#38). DB guards are authoritative; this is copy only.
 * Returns null when the error is not one of these, so callers keep their
 * existing generic handling.
 */
export function testIntegrityErrorMessage(
  message: string | null | undefined
): string | null {
  const lower = (message ?? "").trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes("test_question_year_mismatch")) {
    return "This change would put a question and its test in different classes/years. Remove the question from the affected draft test(s) first.";
  }
  if (lower.includes("deadlock detected")) return CONCURRENT_RETRY;
  return null;
}

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
    if (/question count\s*>=/i.test(trimmed)) {
      return "This test has no questions. Add at least one question before publishing.";
    }
    return trimmed;
  }

  return GENERIC;
}
