import { completionPercent } from "./engine.ts";

export type McqBankFolderPracticeProgress = {
  folder_id: string;
  total: number;
  done: number;
  remaining: number;
  percent_complete: number;
  complete: boolean;
  /** Caller-scoped Favorites count (practice_progress.marked). */
  favorites: number;
  /** Caller-scoped Incorrect count (practice_progress.incorrect). */
  incorrect: number;
};

export type McqBankSubfolderPracticeProgress = {
  subfolder_id: string;
  total: number;
  done: number;
  remaining: number;
  percent_complete: number;
  complete: boolean;
  favorites: number;
  incorrect: number;
};

/** Shared practice-progress shape used by McqPracticePanel. */
export type McqBankContainerPracticeProgress = {
  container_id: string;
  total: number;
  done: number;
  remaining: number;
  percent_complete: number;
  complete: boolean;
  favorites: number;
  incorrect: number;
};

function normalizeContainerProgress(
  raw: Record<string, unknown> | null | undefined,
  idField: "folder_id" | "subfolder_id",
  fallbackId?: string
): McqBankContainerPracticeProgress {
  const total = Math.max(0, Number(raw?.total ?? 0) || 0);
  const done = Math.max(0, Math.min(total, Number(raw?.done ?? 0) || 0));
  const remaining = Math.max(0, total - done);
  const favorites = Math.max(0, Number(raw?.favorites ?? 0) || 0);
  const incorrect = Math.max(0, Number(raw?.incorrect ?? 0) || 0);
  const percent =
    typeof raw?.percent_complete === "number"
      ? Math.max(0, Math.min(100, Math.round(raw.percent_complete)))
      : completionPercent(done, total);
  return {
    container_id: String(raw?.[idField] ?? fallbackId ?? ""),
    total,
    done,
    remaining,
    percent_complete: percent,
    complete: total > 0 && done >= total,
    favorites,
    incorrect,
  };
}

export function normalizeFolderPracticeProgress(
  raw: Record<string, unknown> | null | undefined,
  folderId?: string
): McqBankFolderPracticeProgress {
  const p = normalizeContainerProgress(raw, "folder_id", folderId);
  return {
    folder_id: p.container_id,
    total: p.total,
    done: p.done,
    remaining: p.remaining,
    percent_complete: p.percent_complete,
    complete: p.complete,
    favorites: p.favorites,
    incorrect: p.incorrect,
  };
}

export function normalizeSubfolderPracticeProgress(
  raw: Record<string, unknown> | null | undefined,
  subfolderId?: string
): McqBankSubfolderPracticeProgress {
  const p = normalizeContainerProgress(raw, "subfolder_id", subfolderId);
  return {
    subfolder_id: p.container_id,
    total: p.total,
    done: p.done,
    remaining: p.remaining,
    percent_complete: p.percent_complete,
    complete: p.complete,
    favorites: p.favorites,
    incorrect: p.incorrect,
  };
}

export function toContainerPracticeProgress(
  progress:
    | McqBankFolderPracticeProgress
    | McqBankSubfolderPracticeProgress
    | McqBankContainerPracticeProgress
): McqBankContainerPracticeProgress {
  if ("container_id" in progress) return progress;
  if ("subfolder_id" in progress) {
    return {
      container_id: progress.subfolder_id,
      total: progress.total,
      done: progress.done,
      remaining: progress.remaining,
      percent_complete: progress.percent_complete,
      complete: progress.complete,
      favorites: progress.favorites,
      incorrect: progress.incorrect,
    };
  }
  return {
    container_id: progress.folder_id,
    total: progress.total,
    done: progress.done,
    remaining: progress.remaining,
    percent_complete: progress.percent_complete,
    complete: progress.complete,
    favorites: progress.favorites,
    incorrect: progress.incorrect,
  };
}

export function folderPracticeProgressLabel(p: {
  done: number;
  total: number;
}): string {
  return `${p.done}/${p.total}`;
}
