/** Pure helpers for Academic MCQ Bank folder admin UI (no I/O). */

export type McqBankFolderCounts = {
  question_count: number;
  pdf_count: number;
  /** Present when admin_list_mcq_bank_folders returns it; preferred for delete emptiness. */
  subfolder_count?: number;
};

/**
 * Empty for delete when no subfolders and no live PDFs.
 * Prefer subfolder_count from RPC; else treat question_count as proxy
 * (question_count is now aggregate from subfolders only).
 */
export function isMcqBankFolderEmptyForDelete(
  folder: McqBankFolderCounts
): boolean {
  const blocking =
    typeof folder.subfolder_count === "number"
      ? folder.subfolder_count
      : folder.question_count;
  return blocking <= 0 && folder.pdf_count <= 0;
}

export function mcqBankFolderContentSummary(
  folder: McqBankFolderCounts
): string {
  const q = folder.question_count;
  const p = folder.pdf_count;
  const qLabel = `${q} question${q === 1 ? "" : "s"}`;
  const pLabel = `${p} PDF${p === 1 ? "" : "s"}`;
  if (typeof folder.subfolder_count === "number") {
    const s = folder.subfolder_count;
    const sLabel = `${s} subfolder${s === 1 ? "" : "s"}`;
    return `${qLabel} · ${sLabel} · ${pLabel}`;
  }
  return `${qLabel} · ${pLabel}`;
}

export function mcqBankFolderDeleteBlockedReason(
  folder: McqBankFolderCounts
): string | null {
  if (isMcqBankFolderEmptyForDelete(folder)) return null;
  const parts: string[] = [];
  if (typeof folder.subfolder_count === "number") {
    if (folder.subfolder_count > 0) {
      parts.push(
        `${folder.subfolder_count} subfolder${folder.subfolder_count === 1 ? "" : "s"}`
      );
    }
  } else if (folder.question_count > 0) {
    parts.push(
      `${folder.question_count} question${folder.question_count === 1 ? "" : "s"}`
    );
  }
  if (folder.pdf_count > 0) {
    parts.push(`${folder.pdf_count} PDF${folder.pdf_count === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return null;
  return `Remove ${parts.join(" and ")} first.`;
}
