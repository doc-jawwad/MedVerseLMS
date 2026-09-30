/** Practice product progress — separate from formal exam attempts. */

export type PracticeItemKind = "mcq" | "pearl" | "ospe";

/** Per-item product state. Default when no row exists is remaining. */
export type PracticeItemState = "remaining" | "done";

/**
 * Deck filters. `marked` is the Favorites product filter
 * (DB column practice_progress.marked).
 */
export type PracticeFilter = "all" | "remaining" | "done" | "marked";

export type PracticeProgressRecord = {
  studentId: string;
  itemKind: PracticeItemKind;
  itemId: string;
  state: PracticeItemState;
  /** Favorites flag — maps to practice_progress.marked. */
  marked: boolean;
  updatedAt: string;
};

export type PracticeDeckItem = {
  itemId: string;
  itemKind: PracticeItemKind;
  state: PracticeItemState;
  /** Favorites flag — maps to practice_progress.marked. */
  marked: boolean;
};

export type PracticeFilterCounts = Record<PracticeFilter, number>;

export type PracticeSessionStats = {
  /** Items answered / revealed this session (not lifetime). */
  practiced: number;
  /** Correct MCQ checks this session. Pearls leave this at 0. */
  correct: number;
};

export type PracticeSessionReport = {
  totalPracticed: number;
  timeTakenMs: number;
  correct: number;
  /** 0–100; 0 when nothing practiced. */
  accuracyPercent: number;
};

export type PracticeScopeType =
  | "subject"
  | "book"
  | "chapter"
  | "topic"
  | "prof_session_day"
  | "mcq_bank_folder"
  | "mcq_bank_folder_favorites"
  | "mcq_bank_folder_incorrect";

export const PRACTICE_SCOPE_TYPES = [
  "subject",
  "book",
  "chapter",
  "topic",
  "prof_session_day",
  "mcq_bank_folder",
  "mcq_bank_folder_favorites",
  "mcq_bank_folder_incorrect",
] as const satisfies readonly PracticeScopeType[];

export function isPracticeScopeType(value: string): value is PracticeScopeType {
  return (PRACTICE_SCOPE_TYPES as readonly string[]).includes(value);
}

export type PracticeScope = {
  type: PracticeScopeType;
  id: string;
  title: string;
};
