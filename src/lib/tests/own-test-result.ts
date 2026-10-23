/** Historical owned result summary from get_own_test_result (8J-B). */

export type OwnTestResultTest = {
  id: string;
  title: string;
  closes_at: string;
  show_review: string;
  negative_mark: number | string;
  /** Per-test attempt limit (1 = single attempt). */
  max_attempts: number;
};

export type OwnTestResultAttempt = {
  id: string;
  state: "submitted";
  score: number | string | null;
  max_score: number | string | null;
  raw_correct: number | string | null;
  raw_wrong: number | string | null;
  raw_blank: number | string | null;
  percentage: number | string | null;
  rank: number | string | null;
  percentile: number | string | null;
  submitted_at: string | null;
  submit_source: string | null;
};

export type OwnTestResultInvalidated = {
  id: string;
  invalidated_reason: string | null;
};

/** One row of the caller's own attempt history for the test. */
export type OwnTestResultHistoryRow = {
  id: string;
  attempt_no: number;
  state: "in_progress" | "submitted" | "invalidated";
  started_at: string | null;
  submitted_at: string | null;
  score: number | string | null;
  max_score: number | string | null;
  percentage: number | string | null;
  is_ranked: boolean;
};

export type OwnTestResult = {
  test: OwnTestResultTest;
  /** The ranked (best submitted) attempt. */
  attempt: OwnTestResultAttempt;
  invalidated: OwnTestResultInvalidated[];
  /** Counted attempts (in_progress + submitted). */
  attempts_used: number;
  has_in_progress: boolean;
  attempts: OwnTestResultHistoryRow[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Accept only the historical summary. Never copy review/question payload
 * even if a malformed RPC response included it.
 */
export function parseOwnTestResult(raw: unknown): OwnTestResult | null {
  const root = asRecord(raw);
  if (!root) return null;

  const testRaw = asRecord(root.test);
  const attemptRaw = asRecord(root.attempt);
  if (!testRaw || !attemptRaw) return null;

  const testId = asId(testRaw.id);
  const title = typeof testRaw.title === "string" ? testRaw.title : null;
  const attemptId = asId(attemptRaw.id);
  if (!testId || !title || !attemptId) return null;
  if (attemptRaw.state !== "submitted") return null;

  const invalidatedRaw = Array.isArray(root.invalidated) ? root.invalidated : [];
  const invalidated: OwnTestResultInvalidated[] = [];
  for (const row of invalidatedRaw) {
    const rec = asRecord(row);
    const id = rec ? asId(rec.id) : null;
    if (!id) continue;
    invalidated.push({
      id,
      invalidated_reason:
        typeof rec?.invalidated_reason === "string" ? rec.invalidated_reason : null,
    });
  }

  const historyRaw = Array.isArray(root.attempts) ? root.attempts : [];
  const attempts: OwnTestResultHistoryRow[] = [];
  for (const row of historyRaw) {
    const rec = asRecord(row);
    const id = rec ? asId(rec.id) : null;
    const state = rec?.state;
    if (
      !rec ||
      !id ||
      (state !== "in_progress" && state !== "submitted" && state !== "invalidated")
    ) {
      continue;
    }
    attempts.push({
      id,
      attempt_no: Number(rec.attempt_no) || attempts.length + 1,
      state,
      started_at: typeof rec.started_at === "string" ? rec.started_at : null,
      submitted_at: typeof rec.submitted_at === "string" ? rec.submitted_at : null,
      score: (rec.score as number | string | null) ?? null,
      max_score: (rec.max_score as number | string | null) ?? null,
      percentage: (rec.percentage as number | string | null) ?? null,
      is_ranked: rec.is_ranked === true,
    });
  }
  const maxAttemptsRaw = Number(testRaw.max_attempts);

  return {
    test: {
      id: testId,
      title,
      closes_at: typeof testRaw.closes_at === "string" ? testRaw.closes_at : "",
      show_review: typeof testRaw.show_review === "string" ? testRaw.show_review : "",
      negative_mark:
        typeof testRaw.negative_mark === "number" ||
        typeof testRaw.negative_mark === "string"
          ? testRaw.negative_mark
          : 0,
      max_attempts:
        Number.isInteger(maxAttemptsRaw) && maxAttemptsRaw >= 1 ? maxAttemptsRaw : 1,
    },
    attempt: {
      id: attemptId,
      state: "submitted",
      score: (attemptRaw.score as number | string | null) ?? null,
      max_score: (attemptRaw.max_score as number | string | null) ?? null,
      raw_correct: (attemptRaw.raw_correct as number | string | null) ?? null,
      raw_wrong: (attemptRaw.raw_wrong as number | string | null) ?? null,
      raw_blank: (attemptRaw.raw_blank as number | string | null) ?? null,
      percentage: (attemptRaw.percentage as number | string | null) ?? null,
      rank: (attemptRaw.rank as number | string | null) ?? null,
      percentile: (attemptRaw.percentile as number | string | null) ?? null,
      submitted_at:
        typeof attemptRaw.submitted_at === "string" ? attemptRaw.submitted_at : null,
      submit_source:
        typeof attemptRaw.submit_source === "string" ? attemptRaw.submit_source : null,
    },
    invalidated,
    attempts_used: Number.isFinite(Number(root.attempts_used))
      ? Number(root.attempts_used)
      : 1,
    has_in_progress: root.has_in_progress === true,
    attempts,
  };
}
