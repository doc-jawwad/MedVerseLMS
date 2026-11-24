/**
 * A PostgREST DELETE can succeed with zero affected rows (including RLS denial).
 * Only acknowledge a highlight removal after receiving its deleted row.
 */
export function confirmPdfHighlightDeleted(
  rows: readonly { id: string }[] | null,
  highlightId: string
): void {
  if (!rows?.some((row) => row.id === highlightId)) {
    throw new Error("highlight_not_deleted");
  }
}
