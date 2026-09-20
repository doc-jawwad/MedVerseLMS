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
import type { PracticeScope } from "@/lib/practice/types";

const BATCH_SIZE = 50;

type RpcQuestion = {
  question_id: string;
  question_version_id: string;
  stem: string;
  options: { key: string; text: string }[] | string;
  difficulty: string;
  subject_id?: string;
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
  const loadStarted = useRef(false);

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
        setError(
          rpcError.message.includes("practice_access_denied")
            ? "You don't have practice access for this subject. Ask your admin."
            : "Could not load practice questions. Please try again."
        );
        return;
      }
      const rows = ((data ?? []) as RpcQuestion[]).map(toContent);
      const seen = new Set<string>();
      const unique: PracticeMcqContent[] = [];
      for (const row of rows) {
        if (seen.has(row.itemId)) continue;
        seen.add(row.itemId);
        unique.push(row);
      }
      setContents(unique);

      if (scope.type === "subject") {
        setSubjectIds([scope.id]);
      } else if (unique[0]) {
        const { data: q } = await supabase
          .from("questions")
          .select("subject_id")
          .eq("id", unique[0].itemId)
          .maybeSingle();
        if (q?.subject_id) setSubjectIds([q.subject_id as string]);
      }

      const sid =
        scope.type === "subject"
          ? scope.id
          : null;
      sessionIdRef.current = await startPracticeSessionRpc(supabase, sid);
    })();
  }, [supabase, scope.type, scope.id]);

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
  }, [currentContent, selected, deck, supabase]);

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
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <p className="text-muted-foreground">No questions available here yet.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={backHref}>Back to MCQ Bank</Link>
        </Button>
      </div>
    );
  }

  const positionLabel =
    deck.filtered.length === 0
      ? "No items in this filter"
      : `${deck.index + 1} of ${deck.filtered.length}`;

  return (
    <PracticeSessionChrome
      eyebrow="Practice MCQ"
      title={scope.title}
      positionLabel={positionLabel}
      elapsedMs={deck.timeTakenMs}
      completionPercent={deck.completion}
      filter={deck.filter}
      counts={deck.counts}
      onFilterChange={deck.changeFilter}
      marked={deck.current?.marked ?? false}
      onToggleMark={() => void deck.toggleMark()}
      onResetDone={() => void deck.resetDone()}
      onEnd={endAndReport}
      canGoPrev={deck.index > 0}
      canGoNext={deck.index < deck.filtered.length - 1}
      onPrev={() => deck.go("previous")}
      onNext={() => deck.go("next")}
    >
      {!deck.current || !currentContent ? (
        <div className="rounded-3xl border border-dashed border-[var(--student-ink)]/15 p-8 text-center text-sm text-muted-foreground">
          Nothing matches this filter. Try All or Remaining, or reset Done items.
        </div>
      ) : (
        <article className="grid gap-4 rounded-3xl border border-[var(--student-ink)]/10 bg-gradient-to-b from-white to-[var(--brand-teal)]/[0.04] p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[var(--student-ink)]/8 px-2.5 py-1 font-semibold tracking-wide text-[var(--student-ink)]/70 uppercase">
              {currentContent.difficulty}
            </span>
            {deck.current.state === "done" && (
              <span className="rounded-full bg-[var(--brand-teal)]/15 px-2.5 py-1 font-semibold text-[var(--brand-teal-ink)]">
                Done
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
                      ? "border-emerald-600 bg-emerald-50"
                      : isWrongPick
                        ? "border-red-500 bg-red-50"
                        : isSelected
                          ? "border-[#05AEA9] bg-[var(--brand-teal)]/10"
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
                  ? "bg-emerald-50 text-emerald-950"
                  : "bg-red-50 text-red-950"
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
              <Button
                type="button"
                onClick={() => deck.go("next")}
                disabled={deck.index >= deck.filtered.length - 1}
              >
                Next question
              </Button>
            )}
          </div>
        </article>
      )}
    </PracticeSessionChrome>
  );
}

/** @deprecated Prefer PracticeMcqSession — kept as alias for route imports. */
export { PracticeMcqSession as PracticeSession };
