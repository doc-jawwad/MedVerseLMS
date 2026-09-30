"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { PracticeSessionChrome } from "@/components/practice/practice-session-chrome";
import { PracticeSessionReportCard } from "@/components/practice/practice-session-report";
import {
  createSpineProgressStore,
  endPracticeSessionRpc,
  startPracticeSessionRpc,
} from "@/lib/practice/spine-progress-store";
import { usePracticeDeckController } from "@/lib/practice/use-practice-deck";
import type {
  PracticeAnswerFeedback,
  PracticeMcqContent,
} from "@/lib/practice/content";
import { progressSubjectIdsFromPracticeBatch } from "@/lib/practice/progress-subject-ids";
import { practiceBatchAccessMessage } from "@/lib/practice/scope";
import type { PracticeScope } from "@/lib/practice/types";
import { FolderPracticeCompleteGate } from "@/components/practice/folder-practice-complete-gate";
import {
  normalizeFolderPracticeProgress,
  normalizeSubfolderPracticeProgress,
  type McqBankContainerPracticeProgress,
} from "@/lib/practice/mcq-bank-folder-progress";
import {
  folderRoundCompleteHint,
  isMcqBankFolderPracticeScope,
  isMcqBankSubfolderPracticeScope,
  MCQ_FOLDER_PRACTICE_BATCH_SIZE,
  practiceSessionMeterLabel,
  practiceSessionPositionLabel,
  practiceSetEmptyCopy,
} from "@/lib/practice/session-labels";

const BATCH_SIZE = MCQ_FOLDER_PRACTICE_BATCH_SIZE;

type RpcQuestion = {
  question_id: string;
  question_version_id: string;
  stem: string;
  options: { key: string; text: string }[] | string;
  difficulty: string;
  /** Departmental questions.subject_id — canonical practice_progress key. */
  subject_id?: string | null;
};

function parseOptions(
  options: RpcQuestion["options"]
): { key: string; text: string }[] {
  if (Array.isArray(options)) return options;
  try {
    const parsed = JSON.parse(options) as { key: string; text: string }[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toContent(row: RpcQuestion): PracticeMcqContent {
  return {
    itemId: row.question_id,
    itemKind: "mcq",
    questionVersionId: row.question_version_id,
    stem: row.stem,
    options: parseOptions(row.options),
    difficulty: row.difficulty,
  };
}

/**
 * Practice MCQ session — progress via Data Spine PracticeProgressStore.
 * Answers still go through submit_practice_answer (historical accuracy).
 * Does not use test_attempts.
 */
export function PracticeMcqSession({
  scope,
  studentId,
  backHref = "/mcq-bank",
}: {
  scope: PracticeScope;
  studentId: string;
  backHref?: string;
}) {
  const supabase = useRef(createClient()).current;
  const [subjectIds, setSubjectIds] = useState<string[]>(
    scope.type === "subject" ? [scope.id] : []
  );
  const store = useMemo(
    () =>
      createSpineProgressStore({
        supabase,
        subjectIds,
        studentId,
      }),
    [supabase, subjectIds, studentId]
  );
  const sessionIdRef = useRef<string | null>(null);
  const [contents, setContents] = useState<PracticeMcqContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PracticeAnswerFeedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [folderProgress, setFolderProgress] =
    useState<McqBankContainerPracticeProgress | null>(null);
  const [startedWithItems, setStartedWithItems] = useState(false);
  const loadStarted = useRef(false);
  /** Incorrect MCQs cleared by a correct answer — drop after feedback, on Next. */
  const [pendingIncorrectDropId, setPendingIncorrectDropId] = useState<
    string | null
  >(null);

  const isFavoritesScope =
    scope.type === "mcq_bank_folder_favorites" ||
    scope.type === "mcq_bank_subfolder_favorites";
  const isIncorrectScope =
    scope.type === "mcq_bank_folder_incorrect" ||
    scope.type === "mcq_bank_subfolder_incorrect";
  const isFolderBatchScope = isMcqBankFolderPracticeScope(scope.type);
  const isSubfolderScope = isMcqBankSubfolderPracticeScope(scope.type);
  const isMainContainerScope =
    scope.type === "mcq_bank_folder" || scope.type === "mcq_bank_subfolder";

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    void (async () => {
      setLoading(true);
      const { data, error: rpcError } = await supabase.rpc("get_practice_batch", {
        p_scope_type: scope.type,
        p_scope_id: scope.id,
        p_limit: BATCH_SIZE,
      });
      setLoading(false);
      if (rpcError) {
        setError(practiceBatchAccessMessage(rpcError.message));
        return;
      }
      const rawRows = (data ?? []) as RpcQuestion[];
      const rows = rawRows.map(toContent);
      const seen = new Set<string>();
      const unique: PracticeMcqContent[] = [];
      for (const row of rows) {
        if (seen.has(row.itemId)) continue;
        seen.add(row.itemId);
        unique.push(row);
      }
      setContents(unique);
      setStartedWithItems(unique.length > 0);

      if (scope.type === "mcq_bank_folder") {
        const { data: prog } = await supabase.rpc(
          "get_mcq_bank_folder_practice_progress",
          { p_folder_id: scope.id }
        );
        if (prog) {
          const p = normalizeFolderPracticeProgress(
            prog as Record<string, unknown>,
            scope.id
          );
          setFolderProgress({
            container_id: p.folder_id,
            total: p.total,
            done: p.done,
            remaining: p.remaining,
            percent_complete: p.percent_complete,
            complete: p.complete,
            favorites: p.favorites,
            incorrect: p.incorrect,
          });
        }
      } else if (scope.type === "mcq_bank_subfolder") {
        const { data: prog } = await supabase.rpc(
          "get_mcq_bank_subfolder_practice_progress",
          { p_subfolder_id: scope.id }
        );
        if (prog) {
          const p = normalizeSubfolderPracticeProgress(
            prog as Record<string, unknown>,
            scope.id
          );
          setFolderProgress({
            container_id: p.subfolder_id,
            total: p.total,
            done: p.done,
            remaining: p.remaining,
            percent_complete: p.percent_complete,
            complete: p.complete,
            favorites: p.favorites,
            incorrect: p.incorrect,
          });
        }
      }

      // Progress hydration must use questions.subject_id (returned on the batch).
      // Do not use mcq_bank product subject — writes store departmental subject_id.
      let progressSubjectIds =
        scope.type === "subject"
          ? [scope.id]
          : progressSubjectIdsFromPracticeBatch(rawRows);

      if (progressSubjectIds.length === 0 && scope.type === "prof_session_day") {
        const { data: day } = await supabase
          .from("prof_session_days")
          .select("subject_id")
          .eq("id", scope.id)
          .maybeSingle();
        if (day?.subject_id) {
          progressSubjectIds = [day.subject_id as string];
        }
      }

      setSubjectIds(progressSubjectIds);

      let sessionSubjectId: string | null =
        scope.type === "subject"
          ? scope.id
          : progressSubjectIds[0] ?? null;

      // Folder / subfolder practice sessions may be attributed to the product
      // subject for session summaries; progress store still uses departmental ids.
      if (isFolderBatchScope) {
        if (isSubfolderScope) {
          const { data: subfolder } = await supabase
            .from("mcq_bank_subfolders")
            .select("folder_id")
            .eq("id", scope.id)
            .is("deleted_at", null)
            .maybeSingle();
          if (subfolder?.folder_id) {
            const { data: folder } = await supabase
              .from("mcq_bank_folders")
              .select("academic_product_subject_id")
              .eq("id", subfolder.folder_id as string)
              .is("deleted_at", null)
              .maybeSingle();
            if (folder?.academic_product_subject_id) {
              sessionSubjectId = folder.academic_product_subject_id as string;
            }
          }
        } else {
          const { data: folder } = await supabase
            .from("mcq_bank_folders")
            .select("academic_product_subject_id")
            .eq("id", scope.id)
            .is("deleted_at", null)
            .maybeSingle();
          if (folder?.academic_product_subject_id) {
            sessionSubjectId = folder.academic_product_subject_id as string;
          }
        }
      }

      sessionIdRef.current = await startPracticeSessionRpc(
        supabase,
        sessionSubjectId
      );
    })();
  }, [supabase, scope.type, scope.id, isFolderBatchScope, isSubfolderScope]);

  const itemIds = useMemo(() => contents.map((c) => c.itemId), [contents]);
  const contentById = useMemo(() => {
    const map = new Map(contents.map((c) => [c.itemId, c]));
    return map;
  }, [contents]);

  const deck = usePracticeDeckController({
    studentId,
    itemKind: "mcq",
    itemIds,
    store,
    shuffle: false,
  });

  const currentContent = deck.current
    ? contentById.get(deck.current.itemId) ?? null
    : null;

  useEffect(() => {
    setSelected(null);
    setFeedback(null);
  }, [deck.current?.itemId]);

  const toggleFavorite = useCallback(async () => {
    const itemId = deck.current?.itemId;
    const wasFavorite = deck.current?.marked ?? false;
    await deck.toggleMark();
    // Unfavoriting during Favorites practice drops the MCQ from this deck.
    if (isFavoritesScope && wasFavorite && itemId) {
      setContents((prev) => prev.filter((c) => c.itemId !== itemId));
    }
  }, [deck, isFavoritesScope]);

  const endAndReport = useCallback(() => {
    const taken = deck.timeTakenMs;
    const stats = deck.stats;
    deck.endSession();
    const sid = sessionIdRef.current;
    if (sid) {
      void endPracticeSessionRpc(supabase, {
        sessionId: sid,
        durationMs: taken,
        counts: { practiced: stats.practiced, correct: stats.correct },
      });
    }
  }, [deck, supabase]);

  const flushPendingIncorrectDrop = useCallback(() => {
    if (!pendingIncorrectDropId) return false;
    const dropId = pendingIncorrectDropId;
    setPendingIncorrectDropId(null);
    setContents((prev) => prev.filter((c) => c.itemId !== dropId));
    setSelected(null);
    setFeedback(null);
    return true;
  }, [pendingIncorrectDropId]);

  const goNext = useCallback(() => {
    if (flushPendingIncorrectDrop()) return;
    deck.go("next");
  }, [deck, flushPendingIncorrectDrop]);

  const checkAnswer = useCallback(async () => {
    if (!currentContent || !selected || !deck.current) return;
    setChecking(true);
    const { data, error: rpcError } = await supabase.rpc(
      "submit_practice_answer",
      {
        p_question_version_id: currentContent.questionVersionId,
        p_selected_key: selected,
      }
    );
    setChecking(false);
    if (rpcError) {
      setError("Could not check that answer. Please try again.");
      return;
    }
    const row = (data as {
      is_correct: boolean;
      correct_key: string;
      explanation: string;
      reference: string;
    }[])[0];
    const fb: PracticeAnswerFeedback = {
      isCorrect: row.is_correct,
      correctKey: row.correct_key.trim(),
      explanation: row.explanation ?? "",
      reference: row.reference ?? "",
    };
    setFeedback(fb);
    await deck.markDoneAndRecord(fb.isCorrect);
    // Defer deck removal until Next so feedback stays visible.
    // Favorite flag is independent — submit_practice_answer only toggles incorrect.
    if (isIncorrectScope && fb.isCorrect && currentContent.itemId) {
      setPendingIncorrectDropId(currentContent.itemId);
    }
  }, [currentContent, selected, deck, supabase, isIncorrectScope]);

  if (error) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <p className="text-destructive">{error}</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={backHref}>Back</Link>
        </Button>
      </div>
    );
  }

  if (loading || !deck.hydrated) {
    return (
      <p className="text-sm text-muted-foreground">Loading practice deck…</p>
    );
  }

  if (deck.ended && deck.report) {
    return (
      <PracticeSessionReportCard
        title={scope.title}
        report={deck.report}
        backHref={backHref}
        backLabel="Back to MCQ Bank"
        variant="mcq"
      />
    );
  }

  if (itemIds.length === 0) {
    if (isMainContainerScope) {
      return (
        <FolderPracticeCompleteGate
          folderId={scope.id}
          folderName={scope.title}
          backHref={backHref}
          containerKind={
            scope.type === "mcq_bank_subfolder" ? "subfolder" : "folder"
          }
        />
      );
    }
    if (isFavoritesScope) {
      const copy = practiceSetEmptyCopy({
        mode: "favorites",
        clearedThisSession: startedWithItems,
      });
      return (
        <div
          className="mx-auto grid w-full max-w-2xl gap-4"
          data-testid={copy.testId}
        >
          <div>
            <h1 className="font-heading text-xl font-semibold text-[var(--student-ink)]">
              {copy.title}
            </h1>
            <p className="mt-2 text-muted-foreground">{copy.body}</p>
          </div>
          <Button asChild variant="outline" className="w-fit">
            <Link href={backHref}>
              Back to {isSubfolderScope ? "subfolder" : "folder"}
            </Link>
          </Button>
        </div>
      );
    }
    if (isIncorrectScope) {
      const copy = practiceSetEmptyCopy({
        mode: "incorrect",
        clearedThisSession: startedWithItems,
      });
      return (
        <div
          className="mx-auto grid w-full max-w-2xl gap-4"
          data-testid={copy.testId}
        >
          <div>
            <h1 className="font-heading text-xl font-semibold text-[var(--student-ink)]">
              {copy.title}
            </h1>
            <p className="mt-2 text-muted-foreground">{copy.body}</p>
          </div>
          <Button asChild variant="outline" className="w-fit">
            <Link href={backHref}>
              Back to {isSubfolderScope ? "subfolder" : "folder"}
            </Link>
          </Button>
        </div>
      );
    }
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <p className="text-muted-foreground">No questions available here yet.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={backHref}>Back to MCQ Bank</Link>
        </Button>
      </div>
    );
  }

  const positionLabel = practiceSessionPositionLabel({
    index: deck.index,
    filteredLength: deck.filtered.length,
    scopeType: scope.type,
  });

  const eyebrow = isFavoritesScope
    ? "Practice Favorites"
    : isIncorrectScope
      ? "Practice Incorrect"
      : "Practice MCQ";

  const roundComplete =
    isMainContainerScope &&
    deck.counts.remaining === 0 &&
    deck.counts.done > 0 &&
    deck.counts.done === deck.counts.all;
  const remainingAfterRound =
    folderProgress == null
      ? null
      : Math.max(0, folderProgress.remaining - deck.counts.done);
  const roundHint = roundComplete
    ? folderRoundCompleteHint({
        folderRemaining: remainingAfterRound,
        loadedCount: itemIds.length,
      })
    : null;

  return (
    <PracticeSessionChrome
      eyebrow={eyebrow}
      title={scope.title}
      positionLabel={positionLabel}
      elapsedMs={deck.timeTakenMs}
      completionPercent={deck.completion}
      completionLabel={practiceSessionMeterLabel(scope.type)}
      filter={deck.filter}
      counts={deck.counts}
      onFilterChange={deck.changeFilter}
      marked={deck.current?.marked ?? false}
      onToggleMark={() => void toggleFavorite()}
      onResetDone={() => void deck.resetDone()}
      hideResetDone={isFolderBatchScope}
      onEnd={endAndReport}
      canGoPrev={deck.index > 0}
      canGoNext={
        deck.index < deck.filtered.length - 1 || Boolean(pendingIncorrectDropId)
      }
      onPrev={() => deck.go("previous")}
      onNext={goNext}
    >
      {roundHint ? (
        <div
          className="mb-4 rounded-2xl border border-[var(--brand-teal)]/25 bg-[var(--brand-teal)]/8 p-4 text-sm text-[var(--student-ink)]"
          data-testid="folder-round-complete-hint"
        >
          <p className="font-semibold">This round is done</p>
          <p className="mt-1 text-muted-foreground">{roundHint}</p>
          <Button asChild variant="outline" size="sm" className="mt-3 w-fit">
            <Link href={backHref}>Back to folder</Link>
          </Button>
        </div>
      ) : null}
      {!deck.current || !currentContent ? (
        <div className="rounded-3xl border border-dashed border-[var(--student-ink)]/15 p-8 text-center text-sm text-muted-foreground">
          Nothing matches this filter. Try All or Remaining
          {isFolderBatchScope
            ? ", or return to the folder when this round is finished."
            : ", or reset Done items."}
        </div>
      ) : (
        <article className="surface-card grid gap-4 rounded-3xl border border-border/80 p-4 shadow-none sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[var(--student-ink)]/8 px-2.5 py-1 font-semibold tracking-wide text-[var(--student-ink)]/70 uppercase">
              {currentContent.difficulty}
            </span>
            {deck.current.state === "done" && (
              <span className="rounded-full bg-[var(--brand-teal)]/15 px-2.5 py-1 font-semibold text-[var(--brand-teal-ink)]">
                Done
              </span>
            )}
            {deck.current.marked && (
              <span
                className="rounded-full bg-[var(--student-ink)]/10 px-2.5 py-1 font-semibold text-[var(--student-ink)]"
                data-testid="practice-favorite-badge"
              >
                Favorite
              </span>
            )}
          </div>
          <h2 className="font-heading text-base leading-relaxed font-medium text-[var(--student-ink)] sm:text-lg">
            {currentContent.stem}
          </h2>
          <div className="grid gap-2">
            {currentContent.options.map((o) => {
              const isSelected = selected === o.key;
              const isCorrect = feedback && o.key === feedback.correctKey;
              const isWrongPick =
                feedback && isSelected && !feedback.isCorrect;
              return (
                <button
                  key={o.key}
                  type="button"
                  disabled={Boolean(feedback)}
                  onClick={() => setSelected(o.key)}
                  className={`rounded-2xl border p-3.5 text-left text-sm transition-colors ${
                    isCorrect
                      ? "border-emerald-600 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-100"
                      : isWrongPick
                        ? "border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-950 dark:text-red-100"
                        : isSelected
                          ? "border-[var(--brand-teal)] bg-[var(--brand-teal)]/10"
                          : "border-[var(--student-ink)]/12 hover:bg-[var(--student-ink)]/[0.03]"
                  }`}
                >
                  <span className="mr-2 font-semibold text-[var(--student-ink)]">
                    {o.key}.
                  </span>
                  {o.text}
                </button>
              );
            })}
          </div>

          {feedback && (
            <div
              className={`rounded-2xl p-4 text-sm ${
                feedback.isCorrect
                  ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
                  : "bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-100"
              }`}
            >
              <p className="font-semibold">
                {feedback.isCorrect
                  ? "Correct"
                  : `Incorrect — answer is ${feedback.correctKey}.`}
              </p>
              {feedback.explanation ? (
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                  {feedback.explanation}
                </p>
              ) : null}
              {feedback.reference ? (
                <p className="mt-2 text-xs opacity-70">
                  Reference: {feedback.reference}
                </p>
              ) : null}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!feedback ? (
              <Button
                type="button"
                onClick={() => void checkAnswer()}
                disabled={!selected || checking}
              >
                {checking ? "Checking…" : "Check answer"}
              </Button>
            ) : (
              <Button type="button" onClick={goNext}>
                {pendingIncorrectDropId ||
                deck.index >= deck.filtered.length - 1
                  ? "Continue"
                  : "Next question"}
              </Button>
            )}
          </div>
        </article>
      )}
    </PracticeSessionChrome>
  );
}
