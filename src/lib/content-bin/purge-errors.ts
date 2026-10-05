/**
 * Map Content Bin permanent-delete RPC codes to admin-facing copy.
 * Business snake_case codes pass through sanitize; this adds readable reasons.
 */

const GENERIC = "Something went wrong. Please try again.";

const MESSAGES: Record<string, string> = {
  question_referenced_by_test:
    "Retained because referenced by a test. Remove the question from the draft test (or wait until no test references remain) before permanent delete.",
  mcq_bank_folder_not_empty:
    "This MCQ Bank folder still has live subfolders or questions. Soft-delete those first (Main Admin cascade), then try permanent delete again.",
  subfolder_not_empty:
    "This MCQ Bank subfolder still has live questions. Soft-delete or move them before permanent delete.",
  folder_has_live_descendants:
    "This folder still has live subfolders or materials. Soft-delete those first, then try permanent delete again.",
  permission_denied:
    "You do not have permission to permanently delete this item.",
  year_scope_denied: "You do not have access to this class year.",
  entity_not_found: "That item is no longer in the Bin.",
  not_authenticated: "Please sign in again.",
  invalid_entity_type: "Invalid content reference.",
};

/** Extract a business code from a PostgREST/RPC error message if present. */
export function extractPurgeErrorCode(
  raw: string | null | undefined
): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9_]{1,64}$/i.test(t)) return t.toLowerCase();
  // PostgREST sometimes wraps: `mcq_bank_folder_not_empty` or longer text containing it.
  for (const code of Object.keys(MESSAGES)) {
    if (t.includes(code)) return code;
  }
  return null;
}

export function contentBinPurgeErrorMessage(
  raw: string | null | undefined
): string {
  const code = extractPurgeErrorCode(raw);
  if (code && MESSAGES[code]) return MESSAGES[code];
  return GENERIC;
}
