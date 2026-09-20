import type {
  PracticeItemKind,
  PracticeItemState,
  PracticeProgressRecord,
} from "./types.ts";

/**
 * Persistence contract expected from the Data Spine lane.
 *
 * Key: (student_id, item_kind, item_id)
 * Payload: state remaining|done, marked boolean
 *
 * Must NOT reuse test_attempts.
 * Must NOT delete practice_answers on Done→Remaining reset.
 * Must NOT invent badge thresholds.
 */
export interface PracticeProgressStore {
  getMany(params: {
    studentId: string;
    itemKind: PracticeItemKind;
    itemIds?: readonly string[];
  }): Promise<PracticeProgressRecord[]>;

  upsert(params: {
    studentId: string;
    itemKind: PracticeItemKind;
    itemId: string;
    state?: PracticeItemState;
    marked?: boolean;
  }): Promise<PracticeProgressRecord>;

  setState(params: {
    studentId: string;
    itemKind: PracticeItemKind;
    itemId: string;
    state: PracticeItemState;
  }): Promise<PracticeProgressRecord>;

  setMarked(params: {
    studentId: string;
    itemKind: PracticeItemKind;
    itemId: string;
    marked: boolean;
  }): Promise<PracticeProgressRecord>;

  /**
   * Done → Remaining for matching rows.
   * Preserves `marked`. Does not touch practice_answers history.
   */
  resetDoneToRemaining(params: {
    studentId: string;
    itemKind: PracticeItemKind;
    itemIds?: readonly string[];
  }): Promise<{ resetCount: number }>;
}

export function progressKey(
  studentId: string,
  itemKind: PracticeItemKind,
  itemId: string
): string {
  return `${studentId}:${itemKind}:${itemId}`;
}
