import type {
  PracticeDeckItem,
  PracticeFilter,
  PracticeFilterCounts,
  PracticeItemKind,
  PracticeItemState,
  PracticeProgressRecord,
  PracticeSessionReport,
  PracticeSessionStats,
} from "./types.ts";

export function defaultProgressRecord(
  studentId: string,
  itemKind: PracticeItemKind,
  itemId: string,
  updatedAt = new Date(0).toISOString()
): PracticeProgressRecord {
  return {
    studentId,
    itemKind,
    itemId,
    state: "remaining",
    marked: false,
    updatedAt,
  };
}

export function mergeDeck(
  itemIds: readonly string[],
  itemKind: PracticeItemKind,
  progress: readonly PracticeProgressRecord[],
  studentId = ""
): PracticeDeckItem[] {
  const byId = new Map(progress.map((p) => [p.itemId, p]));
  return itemIds.map((itemId) => {
    const row =
      byId.get(itemId) ?? defaultProgressRecord(studentId, itemKind, itemId);
    return {
      itemId,
      itemKind,
      state: row.state,
      marked: row.marked,
    };
  });
}

export function matchesFilter(
  item: Pick<PracticeDeckItem, "state" | "marked">,
  filter: PracticeFilter
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "remaining":
      return item.state === "remaining";
    case "done":
      return item.state === "done";
    case "marked":
      return item.marked;
  }
}

export function filterDeck(
  items: readonly PracticeDeckItem[],
  filter: PracticeFilter
): PracticeDeckItem[] {
  return items.filter((item) => matchesFilter(item, filter));
}

export function filterCounts(
  items: readonly PracticeDeckItem[]
): PracticeFilterCounts {
  let remaining = 0;
  let done = 0;
  let marked = 0;
  for (const item of items) {
    if (item.state === "remaining") remaining += 1;
    if (item.state === "done") done += 1;
    if (item.marked) marked += 1;
  }
  return {
    all: items.length,
    remaining,
    done,
    marked,
  };
}

export function setItemMarked(
  item: PracticeDeckItem,
  marked: boolean
): PracticeDeckItem {
  return { ...item, marked };
}

export function toggleItemMarked(item: PracticeDeckItem): PracticeDeckItem {
  return setItemMarked(item, !item.marked);
}

export function setItemState(
  item: PracticeDeckItem,
  state: PracticeItemState
): PracticeDeckItem {
  return { ...item, state };
}

/** Mark practiced item Done (answer checked / pearl revealed). */
export function markItemDone(item: PracticeDeckItem): PracticeDeckItem {
  return setItemState(item, "done");
}

/** Pure Done → Remaining transform. Preserves marked. */
export function resetDoneInDeck(
  items: readonly PracticeDeckItem[]
): PracticeDeckItem[] {
  return items.map((item) =>
    item.state === "done" ? { ...item, state: "remaining" } : item
  );
}

/**
 * Folder / deck completion percentage.
 * done / total * 100, rounded to nearest int. Empty deck → 0.
 */
export function completionPercent(doneCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  if (doneCount <= 0) return 0;
  return Math.round((100 * Math.min(doneCount, totalCount)) / totalCount);
}

export function deckCompletionPercent(items: readonly PracticeDeckItem[]): number {
  const counts = filterCounts(items);
  return completionPercent(counts.done, counts.all);
}

export type NavigateDirection = "next" | "previous";

export function navigateIndex(
  currentIndex: number,
  filteredLength: number,
  direction: NavigateDirection
): number {
  if (filteredLength <= 0) return 0;
  if (direction === "next") {
    return Math.min(currentIndex + 1, filteredLength - 1);
  }
  return Math.max(currentIndex - 1, 0);
}

/** Keep a usable index after the filtered list shrinks/changes. */
export function clampIndex(index: number, filteredLength: number): number {
  if (filteredLength <= 0) return 0;
  return Math.max(0, Math.min(index, filteredLength - 1));
}

/**
 * After filter/reset, prefer staying on the same itemId when still visible.
 */
export function resolveIndexAfterChange(
  filtered: readonly PracticeDeckItem[],
  preferredItemId: string | null,
  fallbackIndex: number
): number {
  if (filtered.length === 0) return 0;
  if (preferredItemId) {
    const found = filtered.findIndex((i) => i.itemId === preferredItemId);
    if (found >= 0) return found;
  }
  return clampIndex(fallbackIndex, filtered.length);
}

export function shuffleIds(
  ids: readonly string[],
  random: () => number = Math.random
): string[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function orderItemIds(
  ids: readonly string[],
  shuffle: boolean,
  random: () => number = Math.random
): string[] {
  return shuffle ? shuffleIds(ids, random) : [...ids];
}

export function accuracyPercent(correct: number, practiced: number): number {
  if (practiced <= 0) return 0;
  return Math.round((100 * Math.min(correct, practiced)) / practiced);
}

export function buildSessionReport(input: {
  stats: PracticeSessionStats;
  timeTakenMs: number;
}): PracticeSessionReport {
  const totalPracticed = Math.max(0, input.stats.practiced);
  const correct = Math.max(0, Math.min(input.stats.correct, totalPracticed));
  return {
    totalPracticed,
    timeTakenMs: Math.max(0, input.timeTakenMs),
    correct,
    accuracyPercent: accuracyPercent(correct, totalPracticed),
  };
}

export function bumpSessionStats(
  stats: PracticeSessionStats,
  isCorrect: boolean | null
): PracticeSessionStats {
  return {
    practiced: stats.practiced + 1,
    correct: stats.correct + (isCorrect === true ? 1 : 0),
  };
}

export function replaceDeckItem(
  items: readonly PracticeDeckItem[],
  next: PracticeDeckItem
): PracticeDeckItem[] {
  return items.map((item) => (item.itemId === next.itemId ? next : item));
}
