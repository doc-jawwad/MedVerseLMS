/**
 * Durable local draft for in-progress exam answers (8J-E).
 * Recovery layer only — server save_seq remains authoritative.
 * Never stores stems, options, correct keys, or other protected content.
 */

export const ATTEMPT_DRAFT_VERSION = 1 as const;

export type AttemptDraftAnswer = {
  question_version_id: string;
  selected_key: string | null;
  marked_for_review: boolean;
  seq: number;
};

export type AttemptDraft = {
  v: typeof ATTEMPT_DRAFT_VERSION;
  attempt_id: string;
  answers: Record<string, AttemptDraftAnswer>;
};

export type ServerAnswerRow = {
  question_version_id: string;
  selected_key: string | null;
  marked_for_review: boolean;
  save_seq: number;
};

export type MergedAnswer = {
  question_version_id: string;
  selected_key: string | null;
  marked_for_review: boolean;
  seq: number;
  /** Local is ahead of server and must be flushed. */
  needsFlush: boolean;
};

export function attemptDraftStorageKey(attemptId: string): string {
  return `medverse_attempt:${attemptId}`;
}

export function serializeAttemptDraft(draft: AttemptDraft): string {
  return JSON.stringify(draft);
}

/** Parse draft JSON. Corrupt / foreign / incomplete → null (safe discard). */
export function parseAttemptDraft(
  raw: string | null | undefined,
  expectedAttemptId?: string
): AttemptDraft | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== ATTEMPT_DRAFT_VERSION) return null;
  if (typeof obj.attempt_id !== "string" || !obj.attempt_id) return null;
  if (expectedAttemptId && obj.attempt_id !== expectedAttemptId) return null;
  if (!obj.answers || typeof obj.answers !== "object" || Array.isArray(obj.answers)) {
    return null;
  }

  const answers: Record<string, AttemptDraftAnswer> = {};
  for (const [qvId, row] of Object.entries(
    obj.answers as Record<string, unknown>
  )) {
    if (!row || typeof row !== "object") continue;
    const a = row as Record<string, unknown>;
    if (typeof a.seq !== "number" || !Number.isFinite(a.seq) || a.seq < 1) {
      continue;
    }
    if (a.selected_key !== null && typeof a.selected_key !== "string") continue;
    if (typeof a.marked_for_review !== "boolean") continue;
    const id =
      typeof a.question_version_id === "string" && a.question_version_id
        ? a.question_version_id
        : qvId;
    if (id !== qvId) continue;
    // Reject accidental protected fields if present in corrupt dumps.
    if ("stem" in a || "options" in a || "correct_key" in a || "explanation" in a) {
      continue;
    }
    answers[qvId] = {
      question_version_id: id,
      selected_key: a.selected_key as string | null,
      marked_for_review: a.marked_for_review,
      seq: Math.floor(a.seq),
    };
  }

  return { v: ATTEMPT_DRAFT_VERSION, attempt_id: obj.attempt_id, answers };
}

/** Merge one answer into a draft using higher-seq-wins (never overwrite with older). */
export function upsertDraftAnswer(
  draft: AttemptDraft,
  answer: AttemptDraftAnswer
): AttemptDraft {
  const prev = draft.answers[answer.question_version_id];
  if (prev && prev.seq > answer.seq) return draft;
  return {
    ...draft,
    answers: {
      ...draft.answers,
      [answer.question_version_id]: {
        question_version_id: answer.question_version_id,
        selected_key: answer.selected_key,
        marked_for_review: answer.marked_for_review,
        seq: answer.seq,
      },
    },
  };
}

/**
 * After server ACK of save_seq for a question, drop the local entry when it
 * matches (or is older). Keep a newer local entry that arrived mid-flight.
 */
export function acknowledgeDraftAnswer(
  draft: AttemptDraft,
  questionVersionId: string,
  ackedSeq: number
): AttemptDraft {
  const prev = draft.answers[questionVersionId];
  if (!prev) return draft;
  if (prev.seq > ackedSeq) return draft;
  const next = { ...draft.answers };
  delete next[questionVersionId];
  return { ...draft, answers: next };
}

/**
 * Per-question merge: higher save_seq wins; equal seq prefers server.
 * Local-ahead rows are flagged for flush.
 */
export function mergeServerAndLocalAnswers(
  serverAnswers: ServerAnswerRow[],
  localDraft: AttemptDraft | null
): MergedAnswer[] {
  const byQv = new Map<string, MergedAnswer>();

  for (const s of serverAnswers) {
    byQv.set(s.question_version_id, {
      question_version_id: s.question_version_id,
      selected_key: s.selected_key,
      marked_for_review: s.marked_for_review,
      seq: s.save_seq,
      needsFlush: false,
    });
  }

  if (localDraft) {
    for (const local of Object.values(localDraft.answers)) {
      const existing = byQv.get(local.question_version_id);
      if (!existing) {
        byQv.set(local.question_version_id, {
          question_version_id: local.question_version_id,
          selected_key: local.selected_key,
          marked_for_review: local.marked_for_review,
          seq: local.seq,
          needsFlush: true,
        });
        continue;
      }
      if (local.seq > existing.seq) {
        byQv.set(local.question_version_id, {
          question_version_id: local.question_version_id,
          selected_key: local.selected_key,
          marked_for_review: local.marked_for_review,
          seq: local.seq,
          needsFlush: true,
        });
      }
      // equal or server higher: keep server (needsFlush stays false)
    }
  }

  return [...byQv.values()];
}

export function maxSeqAmong(
  serverAnswers: ServerAnswerRow[],
  localDraft: AttemptDraft | null
): number {
  let max = 0;
  for (const s of serverAnswers) max = Math.max(max, s.save_seq);
  if (localDraft) {
    for (const a of Object.values(localDraft.answers)) {
      max = Math.max(max, a.seq);
    }
  }
  return max;
}

export function emptyAttemptDraft(attemptId: string): AttemptDraft {
  return { v: ATTEMPT_DRAFT_VERSION, attempt_id: attemptId, answers: {} };
}

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function getStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadAttemptDraft(attemptId: string): AttemptDraft | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return parseAttemptDraft(
      storage.getItem(attemptDraftStorageKey(attemptId)),
      attemptId
    );
  } catch {
    return null;
  }
}

/**
 * Persist draft. Merges with any concurrent tab write using higher-seq-wins.
 * Returns false if storage is unavailable or quota failed.
 */
export function saveAttemptDraft(draft: AttemptDraft): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const existing = parseAttemptDraft(
      storage.getItem(attemptDraftStorageKey(draft.attempt_id)),
      draft.attempt_id
    );
    let merged = draft;
    if (existing) {
      merged = emptyAttemptDraft(draft.attempt_id);
      for (const a of Object.values(existing.answers)) {
        merged = upsertDraftAnswer(merged, a);
      }
      for (const a of Object.values(draft.answers)) {
        merged = upsertDraftAnswer(merged, a);
      }
    }
    if (Object.keys(merged.answers).length === 0) {
      storage.removeItem(attemptDraftStorageKey(draft.attempt_id));
      return true;
    }
    storage.setItem(
      attemptDraftStorageKey(draft.attempt_id),
      serializeAttemptDraft(merged)
    );
    return true;
  } catch {
    return false;
  }
}

export function clearAttemptDraft(attemptId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(attemptDraftStorageKey(attemptId));
  } catch {
    // ignore
  }
}

/** Write or bump a single answer into durable storage immediately. */
export function persistDraftAnswer(
  attemptId: string,
  answer: AttemptDraftAnswer
): boolean {
  const existing =
    loadAttemptDraft(attemptId) ?? emptyAttemptDraft(attemptId);
  return saveAttemptDraft(upsertDraftAnswer(existing, answer));
}

/** Drop an acknowledged answer from durable storage. */
export function persistDraftAck(
  attemptId: string,
  questionVersionId: string,
  ackedSeq: number
): void {
  const existing = loadAttemptDraft(attemptId);
  if (!existing) return;
  const next = acknowledgeDraftAnswer(existing, questionVersionId, ackedSeq);
  saveAttemptDraft(next);
}
