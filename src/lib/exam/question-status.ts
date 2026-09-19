/**
 * Exam palette / skip UX derived from the existing attempt_answers row.
 *
 * Skip is not a new attempt state. It is `marked_for_review` with a null
 * `selected_key`, persisted through save_answer like any other answer write.
 * Scoring still treats null selected_key as blank (zero contribution).
 */

export type ExamAnswerState = {
  selected_key: string | null;
  marked_for_review: boolean;
};

export type ExamQuestionStatus = "answered" | "skipped" | "remaining";

export function isAnswered(state?: ExamAnswerState | null): boolean {
  return Boolean(state?.selected_key);
}

/** Unanswered + flagged. Answered+flagged is treated as answered, not skipped. */
export function isSkipped(state?: ExamAnswerState | null): boolean {
  return Boolean(state?.marked_for_review) && !isAnswered(state);
}

export function isRemaining(state?: ExamAnswerState | null): boolean {
  return !isAnswered(state) && !isSkipped(state);
}

export function questionStatus(
  state?: ExamAnswerState | null
): ExamQuestionStatus {
  if (isAnswered(state)) return "answered";
  if (isSkipped(state)) return "skipped";
  return "remaining";
}

export function tallyQuestionStatuses<T extends { question_version_id: string }>(
  questions: T[],
  answers: Record<string, ExamAnswerState | undefined>
): { answered: number; skipped: number; remaining: number; total: number } {
  let answered = 0;
  let skipped = 0;
  for (const q of questions) {
    const status = questionStatus(answers[q.question_version_id]);
    if (status === "answered") answered += 1;
    else if (status === "skipped") skipped += 1;
  }
  const total = questions.length;
  return { answered, skipped, remaining: total - answered - skipped, total };
}

export function skippedQuestionIndexes<T extends { question_version_id: string }>(
  questions: T[],
  answers: Record<string, ExamAnswerState | undefined>
): number[] {
  const out: number[] = [];
  questions.forEach((q, i) => {
    if (isSkipped(answers[q.question_version_id])) out.push(i);
  });
  return out;
}

/** Next remaining (not skipped, not answered) after `from`, wrapping once. */
export function nextRemainingIndex<T extends { question_version_id: string }>(
  questions: T[],
  answers: Record<string, ExamAnswerState | undefined>,
  from: number
): number | null {
  if (questions.length === 0) return null;
  for (let step = 1; step <= questions.length; step++) {
    const i = (from + step) % questions.length;
    if (isRemaining(answers[questions[i]!.question_version_id])) return i;
  }
  return null;
}

export type AnswerAction =
  | { type: "select"; key: string }
  | { type: "skip" }
  | { type: "unskip" }
  | { type: "clear" };

/**
 * Local next-row for one MCQ. Selecting an option always clears skip.
 * Skip always clears a selection (skip is unanswered-only).
 */
export function nextAnswerState(
  current: ExamAnswerState | undefined,
  action: AnswerAction
): ExamAnswerState {
  const prev: ExamAnswerState = current ?? {
    selected_key: null,
    marked_for_review: false,
  };
  switch (action.type) {
    case "select":
      if (prev.selected_key === action.key) {
        return { selected_key: null, marked_for_review: false };
      }
      return { selected_key: action.key, marked_for_review: false };
    case "skip":
      return { selected_key: null, marked_for_review: true };
    case "unskip":
      return { selected_key: null, marked_for_review: false };
    case "clear":
      return { selected_key: null, marked_for_review: false };
    default:
      return prev;
  }
}
