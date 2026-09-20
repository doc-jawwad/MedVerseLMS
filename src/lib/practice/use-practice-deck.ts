"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PracticeProgressStore } from "@/lib/practice/progress-store";
import {
  bumpSessionStats,
  clampIndex,
  deckCompletionPercent,
  filterCounts,
  filterDeck,
  markItemDone,
  mergeDeck,
  navigateIndex,
  orderItemIds,
  replaceDeckItem,
  resetDoneInDeck,
  resolveIndexAfterChange,
  toggleItemMarked,
  buildSessionReport,
} from "@/lib/practice/engine";
import { elapsedMs } from "@/lib/practice/timer";
import type {
  PracticeDeckItem,
  PracticeFilter,
  PracticeItemKind,
  PracticeSessionReport,
  PracticeSessionStats,
} from "@/lib/practice/types";

const EMPTY_STATS: PracticeSessionStats = { practiced: 0, correct: 0 };

export function usePracticeDeckController({
  studentId,
  itemKind,
  itemIds,
  store,
  shuffle = false,
}: {
  studentId: string;
  itemKind: PracticeItemKind;
  itemIds: readonly string[];
  store: PracticeProgressStore;
  shuffle?: boolean;
}) {
  const idsKey = itemIds.join("|");
  const orderedIds = useMemo(
    () => orderItemIds(itemIds, shuffle),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable shuffle until ids/shuffle change
    [idsKey, shuffle]
  );

  const [deck, setDeck] = useState<PracticeDeckItem[]>(() =>
    mergeDeck(orderedIds, itemKind, [], studentId)
  );
  const [filter, setFilter] = useState<PracticeFilter>("all");
  const [index, setIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [stats, setStats] = useState<PracticeSessionStats>(EMPTY_STATS);
  const [startedAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [ended, setEnded] = useState(false);
  const [report, setReport] = useState<PracticeSessionReport | null>(null);

  useEffect(() => {
    if (ended) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ended]);

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    void (async () => {
      const progress = await store.getMany({
        studentId,
        itemKind,
        itemIds: orderedIds,
      });
      if (cancelled) return;
      setDeck(mergeDeck(orderedIds, itemKind, progress, studentId));
      setIndex(0);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, studentId, itemKind, orderedIds]);

  const filtered = useMemo(() => filterDeck(deck, filter), [deck, filter]);
  const counts = useMemo(() => filterCounts(deck), [deck]);
  const completion = useMemo(() => deckCompletionPercent(deck), [deck]);
  const current = filtered[clampIndex(index, filtered.length)] ?? null;
  const timeTakenMs =
    ended && report
      ? report.timeTakenMs
      : elapsedMs(startedAtMs, nowMs);

  const changeFilter = useCallback(
    (next: PracticeFilter) => {
      const preferred = current?.itemId ?? null;
      setFilter(next);
      const nextFiltered = filterDeck(deck, next);
      setIndex(resolveIndexAfterChange(nextFiltered, preferred, 0));
    },
    [current?.itemId, deck]
  );

  const go = useCallback(
    (direction: "next" | "previous") => {
      setIndex((i) => navigateIndex(i, filtered.length, direction));
    },
    [filtered.length]
  );

  const persistItem = useCallback(
    async (item: PracticeDeckItem) => {
      setDeck((prev) => replaceDeckItem(prev, item));
      await store.upsert({
        studentId,
        itemKind,
        itemId: item.itemId,
        state: item.state,
        marked: item.marked,
      });
    },
    [store, studentId, itemKind]
  );

  const toggleMark = useCallback(async () => {
    if (!current) return;
    const next = toggleItemMarked(current);
    await persistItem(next);
  }, [current, persistItem]);

  const markDoneAndRecord = useCallback(
    async (isCorrect: boolean | null) => {
      if (!current) return;
      const wasRemaining = current.state === "remaining";
      const next = markItemDone(current);
      await persistItem(next);
      if (wasRemaining) {
        setStats((s) => bumpSessionStats(s, isCorrect));
      } else if (isCorrect !== null) {
        // Re-check of an already-done MCQ still counts toward session accuracy.
        setStats((s) => bumpSessionStats(s, isCorrect));
      }
    },
    [current, persistItem]
  );

  const resetDone = useCallback(async () => {
    const preferred = current?.itemId ?? null;
    await store.resetDoneToRemaining({
      studentId,
      itemKind,
      itemIds: orderedIds,
    });
    const nextDeck = resetDoneInDeck(deck);
    setDeck(nextDeck);
    const nextFiltered = filterDeck(nextDeck, filter);
    setIndex(resolveIndexAfterChange(nextFiltered, preferred, index));
  }, [
    current?.itemId,
    store,
    studentId,
    itemKind,
    orderedIds,
    deck,
    filter,
    index,
  ]);

  const endSession = useCallback(() => {
    const taken = elapsedMs(startedAtMs, Date.now());
    const built = buildSessionReport({ stats, timeTakenMs: taken });
    setReport(built);
    setEnded(true);
  }, [startedAtMs, stats]);

  return {
    hydrated,
    deck,
    filtered,
    filter,
    counts,
    completion,
    index: clampIndex(index, filtered.length),
    current,
    stats,
    timeTakenMs,
    ended,
    report,
    changeFilter,
    go,
    toggleMark,
    markDoneAndRecord,
    resetDone,
    endSession,
    setIndex,
  };
}
