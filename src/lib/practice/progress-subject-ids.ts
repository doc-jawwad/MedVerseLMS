/**
 * Resolve practice_progress subject keys from a practice batch.
 *
 * Canonical key for question progress rows is questions.subject_id
 * (departmental taxonomy) — the same id set_practice_item_* stores.
 * Never substitute mcq_bank_folders.academic_product_subject_id here.
 */
export function progressSubjectIdsFromPracticeBatch(
  rows: readonly { subject_id?: string | null }[]
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row.subject_id;
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
