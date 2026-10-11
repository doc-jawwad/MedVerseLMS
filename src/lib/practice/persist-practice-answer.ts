import type { PracticeAnswerFeedback } from "@/lib/practice/content";

export type PracticeAnswerRpcRow = {
  is_correct: boolean | null;
  correct_key: string | null;
  explanation: string | null;
  reference: string | null;
};

export type PersistPracticeAnswerOk = {
  ok: true;
  /** null when feedback was not revealed (silent Next). */
  isCorrect: boolean | null;
  feedback: PracticeAnswerFeedback | null;
};

export type PersistPracticeAnswerErr = {
  ok: false;
  error: string;
};

export type PersistPracticeAnswerResult =
  | PersistPracticeAnswerOk
  | PersistPracticeAnswerErr;

/**
 * Pure mapper from RPC row → UI result. Used by the session and unit tests.
 * Silent path must not treat leaked is_correct as usable client state.
 */
export function mapPracticeAnswerRpcRow(
  row: PracticeAnswerRpcRow | undefined,
  revealFeedback: boolean
): PersistPracticeAnswerResult {
  if (!row) {
    return { ok: false, error: "Could not save that answer. Please try again." };
  }

  if (!revealFeedback) {
    // Server must return nulls; reject any accidental secret leak.
    if (
      row.is_correct != null ||
      (row.correct_key != null && String(row.correct_key).trim() !== "") ||
      (row.explanation != null && row.explanation !== "") ||
      (row.reference != null && row.reference !== "")
    ) {
      return {
        ok: false,
        error: "Could not save that answer. Please try again.",
      };
    }
    return { ok: true, isCorrect: null, feedback: null };
  }

  if (typeof row.is_correct !== "boolean") {
    return { ok: false, error: "Could not check that answer. Please try again." };
  }
  const correctKey = (row.correct_key ?? "").trim();
  if (!correctKey) {
    return { ok: false, error: "Could not check that answer. Please try again." };
  }
  return {
    ok: true,
    isCorrect: row.is_correct,
    feedback: {
      isCorrect: row.is_correct,
      correctKey,
      explanation: row.explanation ?? "",
      reference: row.reference ?? "",
    },
  };
}

/**
 * Session-local commit tracker so Check + Next never double-count totals.
 */
export function createPracticeAnswerCommitLedger() {
  const committed = new Map<
    string,
    { selectedKey: string; isCorrect: boolean | null }
  >();

  return {
    has(versionId: string): boolean {
      return committed.has(versionId);
    },
    get(versionId: string) {
      return committed.get(versionId) ?? null;
    },
    /** @returns true if this is the first commit for the version (count once). */
    commit(
      versionId: string,
      selectedKey: string,
      isCorrect: boolean | null
    ): boolean {
      if (committed.has(versionId)) return false;
      committed.set(versionId, { selectedKey, isCorrect });
      return true;
    },
  };
}
