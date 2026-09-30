import type { PracticeScopeType } from "./types.ts";

/** Max MCQs loaded per get_practice_batch call for folder practice. */
export const MCQ_FOLDER_PRACTICE_BATCH_SIZE = 50;

export function isMcqBankFolderPracticeScope(
  scopeType: PracticeScopeType
): boolean {
  return (
    scopeType === "mcq_bank_folder" ||
    scopeType === "mcq_bank_folder_favorites" ||
    scopeType === "mcq_bank_folder_incorrect"
  );
}

/**
 * In-session meter must describe the loaded deck/session, never imply
 * the whole folder is complete when only a batch (≤50) is loaded.
 */
export function practiceSessionMeterLabel(
  scopeType: PracticeScopeType
): string {
  if (isMcqBankFolderPracticeScope(scopeType)) return "This round";
  return "Session progress";
}

export function practiceSessionPositionLabel(input: {
  index: number;
  filteredLength: number;
  scopeType: PracticeScopeType;
}): string {
  if (input.filteredLength <= 0) return "No items in this filter";
  const pos = `${input.index + 1} of ${input.filteredLength}`;
  if (isMcqBankFolderPracticeScope(input.scopeType)) {
    return `${pos} in this round`;
  }
  return pos;
}

/** Empty Favorites/Incorrect after clearing the set vs never having any. */
export function practiceSetEmptyCopy(input: {
  mode: "favorites" | "incorrect";
  clearedThisSession: boolean;
}): { title: string; body: string; testId: string } {
  if (input.mode === "favorites") {
    if (input.clearedThisSession) {
      return {
        title: "Favorites round complete",
        body: "No favorited MCQs left in this set. Favorite more during practice, then return here.",
        testId: "favorites-practice-empty",
      };
    }
    return {
      title: "No favorites yet",
      body: "No favorited MCQs in this folder yet. Favorite questions during practice, then return here.",
      testId: "favorites-practice-empty",
    };
  }
  if (input.clearedThisSession) {
    return {
      title: "Incorrect set cleared",
      body: "You got through the currently incorrect MCQs. Wrong answers during practice will appear here again.",
      testId: "incorrect-practice-empty",
    };
  }
  return {
    title: "No incorrect MCQs",
    body: "No incorrect MCQs in this folder. Wrong answers during practice appear here until you get them right.",
    testId: "incorrect-practice-empty",
  };
}

/**
 * When a normal folder round has finished every loaded item, tell the student
 * whether the folder still has unfinished MCQs outside this batch.
 */
export function folderRoundCompleteHint(input: {
  folderRemaining: number | null;
  loadedCount: number;
  batchLimit?: number;
}): string | null {
  const limit = input.batchLimit ?? MCQ_FOLDER_PRACTICE_BATCH_SIZE;
  if (input.folderRemaining == null) {
    if (input.loadedCount >= limit) {
      return `This round loaded ${input.loadedCount} unfinished MCQs. Return to the folder to continue with any that remain.`;
    }
    return null;
  }
  if (input.folderRemaining > 0) {
    return `${input.folderRemaining} unfinished MCQ${
      input.folderRemaining === 1 ? "" : "s"
    } still in this folder. Return to the folder and start practice again for the next round.`;
  }
  return "You finished every unfinished MCQ loaded in this round. Return to the folder when you are ready.";
}
