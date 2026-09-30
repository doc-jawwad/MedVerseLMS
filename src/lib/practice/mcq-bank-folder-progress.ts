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
};

export function normalizeFolderPracticeProgress(
  raw: Record<string, unknown> | null | undefined,
  folderId?: string
): McqBankFolderPracticeProgress {
  const total = Math.max(0, Number(raw?.total ?? 0) || 0);
  const done = Math.max(0, Math.min(total, Number(raw?.done ?? 0) || 0));
  const remaining = Math.max(0, total - done);
  const favorites = Math.max(0, Number(raw?.favorites ?? 0) || 0);
  const percent =
    typeof raw?.percent_complete === "number"
      ? Math.max(0, Math.min(100, Math.round(raw.percent_complete)))
      : completionPercent(done, total);
  return {
    folder_id: String(raw?.folder_id ?? folderId ?? ""),
    total,
    done,
    remaining,
    percent_complete: percent,
    complete: total > 0 && done >= total,
    favorites,
  };
}

export function folderPracticeProgressLabel(p: {
  done: number;
  total: number;
}): string {
  return `${p.done}/${p.total}`;
}
