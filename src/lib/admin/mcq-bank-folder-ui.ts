/** Pure helpers for Academic MCQ Bank folder admin UI (no I/O). */

export type McqBankFolderCounts = {
  question_count: number;
  pdf_count: number;
};

/** Same empty contract as admin_soft_delete_mcq_bank_folder (questions + live PDFs). */
export function isMcqBankFolderEmptyForDelete(
  folder: McqBankFolderCounts
): boolean {
  return folder.question_count <= 0 && folder.pdf_count <= 0;
}

export function mcqBankFolderContentSummary(
  folder: McqBankFolderCounts
): string {
  const q = folder.question_count;
  const p = folder.pdf_count;
  const qLabel = `${q} question${q === 1 ? "" : "s"}`;
  const pLabel = `${p} PDF${p === 1 ? "" : "s"}`;
  return `${qLabel} · ${pLabel}`;
}

export function mcqBankFolderDeleteBlockedReason(
  folder: McqBankFolderCounts
): string | null {
  if (isMcqBankFolderEmptyForDelete(folder)) return null;
  const parts: string[] = [];
  if (folder.question_count > 0) {
    parts.push(
      `${folder.question_count} question${folder.question_count === 1 ? "" : "s"}`
    );
  }
  if (folder.pdf_count > 0) {
    parts.push(`${folder.pdf_count} PDF${folder.pdf_count === 1 ? "" : "s"}`);
  }
  return `Remove ${parts.join(" and ")} first.`;
}
