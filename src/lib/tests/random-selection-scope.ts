/**
 * Exact MCQ Bank scope for Test Creation random (and pool) selection.
 *
 * Curriculum filters (subject/book/chapter/topic) stay orthogonal.
 * MCQ Bank placement uses questions.mcq_bank_folder_id /
 * questions.mcq_bank_subfolder_id — never silently broaden to the whole
 * subject when a bank/folder/subfolder was requested.
 */

export type RandomSelectionFilter = {
  subject_id?: string;
  book_id?: string;
  chapter_id?: string;
  topic_id?: string;
  difficulty?: string;
  /** Stem text search — same `stem_normalized` ilike as the visible pool. */
  q?: string;
  /** CSV import set scope — same `import_rows.question_id` set as the pool. */
  import_batch_id?: string;
  /** Product Block / Final-Year subject that owns the MCQ Bank. */
  mcq_bank_product_subject_id?: string;
  mcq_bank_folder_id?: string;
  mcq_bank_subfolder_id?: string;
};

export type McqBankFolderRow = {
  id: string;
  year_id: string;
  academic_product_subject_id: string;
};

export type McqBankSubfolderRow = {
  id: string;
  folder_id: string;
};

export type McqBankScopeConstraint =
  | { kind: "none" }
  | { kind: "subfolder"; subfolderId: string }
  | { kind: "folder"; folderId: string }
  | { kind: "bank_folders"; folderIds: string[] }
  | { kind: "invalid"; reason: string };

/**
 * Resolve the narrowest MCQ Bank scope the admin explicitly selected.
 * Inconsistent or cross-year IDs are `invalid` (caller must not fall back).
 */
export function resolveMcqBankScope(opts: {
  filter: Pick<
    RandomSelectionFilter,
    | "mcq_bank_product_subject_id"
    | "mcq_bank_folder_id"
    | "mcq_bank_subfolder_id"
  >;
  testYearId: string;
  folders: McqBankFolderRow[];
  subfolders: McqBankSubfolderRow[];
}): McqBankScopeConstraint {
  const bankId = opts.filter.mcq_bank_product_subject_id?.trim() || "";
  const folderId = opts.filter.mcq_bank_folder_id?.trim() || "";
  const subfolderId = opts.filter.mcq_bank_subfolder_id?.trim() || "";

  const foldersById = new Map(opts.folders.map((f) => [f.id, f]));
  const subfoldersById = new Map(opts.subfolders.map((s) => [s.id, s]));

  if (subfolderId) {
    const sub = subfoldersById.get(subfolderId);
    if (!sub) {
      return { kind: "invalid", reason: "subfolder_not_found" };
    }
    const folder = foldersById.get(sub.folder_id);
    if (!folder || folder.year_id !== opts.testYearId) {
      return { kind: "invalid", reason: "subfolder_year_mismatch" };
    }
    if (folderId && folderId !== folder.id) {
      return { kind: "invalid", reason: "subfolder_folder_mismatch" };
    }
    if (bankId && bankId !== folder.academic_product_subject_id) {
      return { kind: "invalid", reason: "subfolder_bank_mismatch" };
    }
    return { kind: "subfolder", subfolderId };
  }

  if (folderId) {
    const folder = foldersById.get(folderId);
    if (!folder || folder.year_id !== opts.testYearId) {
      return { kind: "invalid", reason: "folder_year_mismatch" };
    }
    if (bankId && bankId !== folder.academic_product_subject_id) {
      return { kind: "invalid", reason: "folder_bank_mismatch" };
    }
    return { kind: "folder", folderId };
  }

  if (bankId) {
    const folderIds = opts.folders
      .filter(
        (f) =>
          f.year_id === opts.testYearId &&
          f.academic_product_subject_id === bankId
      )
      .map((f) => f.id);
    return { kind: "bank_folders", folderIds };
  }

  return { kind: "none" };
}

/**
 * Normalised `stem_normalized` ilike pattern for the Search-text filter, or
 * null when blank. Shared by the visible pool and random-add so they match.
 */
export function stemSearchPattern(q: string | null | undefined): string | null {
  const t = q?.trim().toLowerCase();
  return t ? `%${t}%` : null;
}

/** Fisher–Yates pick of up to `n` ids, skipping excluded; no duplicates. */
export function pickRandomQuestionIds(opts: {
  candidateIds: string[];
  excludedIds: Iterable<string>;
  n: number;
  /** Injected RNG for tests; defaults to Math.random. */
  random?: () => number;
}): string[] {
  const excluded = new Set(opts.excludedIds);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const id of opts.candidateIds) {
    if (!id || excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    candidates.push(id);
  }
  const n = Math.max(0, Math.floor(opts.n));
  if (n === 0 || candidates.length === 0) return [];

  const rnd = opts.random ?? Math.random;
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, Math.min(n, candidates.length));
}

/**
 * Whether a question belongs to the resolved MCQ Bank scope.
 * Used by unit tests and any client-side sanity checks.
 */
export function questionMatchesMcqBankScope(
  question: {
    mcq_bank_folder_id?: string | null;
    mcq_bank_subfolder_id?: string | null;
  },
  scope: McqBankScopeConstraint
): boolean {
  if (scope.kind === "none") return true;
  if (scope.kind === "invalid") return false;
  if (scope.kind === "subfolder") {
    return question.mcq_bank_subfolder_id === scope.subfolderId;
  }
  if (scope.kind === "folder") {
    return question.mcq_bank_folder_id === scope.folderId;
  }
  if (scope.kind === "bank_folders") {
    if (scope.folderIds.length === 0) return false;
    return (
      !!question.mcq_bank_folder_id &&
      scope.folderIds.includes(question.mcq_bank_folder_id)
    );
  }
  return false;
}
