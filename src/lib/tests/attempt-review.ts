import { examOptionsFromRpc, type ExamOption } from "../exam/question-options.ts";

/** Canonical paid-review lock reason from get_attempt_review (8J-A). */
export const REVIEW_LOCKED_ENTITLEMENT = "review_locked_entitlement" as const;

export type AttemptReviewItem = {
  idx: number;
  stem: string;
  options: ExamOption[];
  correct_key: string;
  explanation: string;
  reference: string;
  selected_key: string | null;
  voided: boolean;
  void_policy: string | null;
};

export type AttemptReviewPayload = {
  allowed: boolean;
  reason?: string;
  items?: AttemptReviewItem[];
  closes_at?: string;
};

/** get_attempt_review copies question_versions.options; staging may store a key map. */
export type AttemptReviewItemIncoming = Omit<AttemptReviewItem, "options"> & {
  options: unknown;
};

export type AttemptReviewPayloadIncoming = Omit<AttemptReviewPayload, "items"> & {
  items?: AttemptReviewItemIncoming[];
};

export type ResultReviewUi =
  | { kind: "open"; items: AttemptReviewItem[] }
  | { kind: "entitlement_lock" }
  | { kind: "disabled" }
  | { kind: "after_close" }
  | { kind: "none" };

/**
 * Drop any review items unless the RPC explicitly allowed review.
 * UI must never receive stems/keys/explanations on a lock/deny payload.
 */
function normalizeReviewItem(item: AttemptReviewItemIncoming): AttemptReviewItem {
  return {
    idx: item.idx,
    stem: item.stem,
    options: Array.isArray(item.options)
      ? (item.options as ExamOption[])
      : examOptionsFromRpc(item.options),
    correct_key: item.correct_key,
    explanation: item.explanation,
    reference: item.reference,
    selected_key: item.selected_key,
    voided: item.voided,
    void_policy: item.void_policy,
  };
}

export function sanitizeAttemptReview(
  raw: AttemptReviewPayloadIncoming | AttemptReviewPayload | null | undefined
): AttemptReviewPayload | null {
  if (!raw) return null;
  if (raw.allowed === true && Array.isArray(raw.items)) {
    return {
      allowed: true,
      items: raw.items.map((item) =>
        normalizeReviewItem(item as AttemptReviewItemIncoming)
      ),
    };
  }
  return {
    allowed: false,
    reason: raw.reason,
    closes_at: raw.closes_at,
  };
}

export function resultReviewUiState(
  raw: AttemptReviewPayloadIncoming | AttemptReviewPayload | null | undefined
): ResultReviewUi {
  const review = sanitizeAttemptReview(raw);
  if (!review) return { kind: "none" };
  if (review.allowed && review.items) {
    return { kind: "open", items: review.items };
  }
  if (review.reason === REVIEW_LOCKED_ENTITLEMENT) {
    return { kind: "entitlement_lock" };
  }
  if (review.reason === "review_disabled") {
    return { kind: "disabled" };
  }
  if (review.reason === "available_after_close") {
    return { kind: "after_close" };
  }
  return { kind: "none" };
}
