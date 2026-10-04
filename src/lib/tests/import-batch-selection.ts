/**
 * Pure helpers for Test Creation CSV import → selectable batch.
 * Uses existing import_batches / import_rows identity — no parallel import system.
 */

export type ImportedQuestionSet = {
  batchId: string;
  filename: string;
  questionIds: string[];
};

/** Dedupe while preserving first-seen order. */
export function uniqueQuestionIds(ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * IDs from an import batch that are eligible to add to a draft test:
 * in the imported set, not already on the test, optionally restricted to
 * the visible pool (when selecting only what is currently listed).
 */
export function importedSetSelectableIds(opts: {
  importedIds: string[];
  alreadyOnTest: Iterable<string>;
  /** When set, only IDs present in this list are selectable (page/pool scope). */
  poolIds?: Iterable<string>;
}): string[] {
  const onTest = new Set(opts.alreadyOnTest);
  const pool =
    opts.poolIds === undefined ? null : new Set(opts.poolIds);
  return uniqueQuestionIds(opts.importedIds).filter((id) => {
    if (onTest.has(id)) return false;
    if (pool && !pool.has(id)) return false;
    return true;
  });
}

/** Merge manual ticks with an imported-set selection (no duplicates). */
export function mergeSelectionWithImportedSet(
  currentSelected: Iterable<string>,
  importedSelectableIds: string[]
): string[] {
  return uniqueQuestionIds([...currentSelected, ...importedSelectableIds]);
}

/**
 * After add: which imported IDs would be newly attached vs skipped as
 * already-on-test (idempotent re-select).
 */
export function partitionImportedAdd(opts: {
  importedIds: string[];
  alreadyOnTest: Iterable<string>;
}): { toAdd: string[]; alreadyPresent: string[] } {
  const onTest = new Set(opts.alreadyOnTest);
  const toAdd: string[] = [];
  const alreadyPresent: string[] = [];
  for (const id of uniqueQuestionIds(opts.importedIds)) {
    if (onTest.has(id)) alreadyPresent.push(id);
    else toAdd.push(id);
  }
  return { toAdd, alreadyPresent };
}
