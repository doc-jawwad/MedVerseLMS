"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { openPearl } from "@/lib/actions/pearls";
import { studyErrorMessage } from "@/lib/study/errors";
import { Button } from "@/components/ui/button";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { PracticeSessionChrome } from "@/components/practice/practice-session-chrome";
import { PracticeSessionReportCard } from "@/components/practice/practice-session-report";
import {
  createSpineProgressStore,
  endPracticeSessionRpc,
  startPracticeSessionRpc,
} from "@/lib/practice/spine-progress-store";
import { usePracticeDeckController } from "@/lib/practice/use-practice-deck";
import { createClient } from "@/lib/supabase/client";

export type PearlCatalogItem = {
  id: string;
  prompt: string;
  year_id: string;
  subject_id: string;
  chapter_id: string | null;
  topic_id: string | null;
  accessible: boolean;
  subject_name?: string | null;
};

/**
 * Pearl Points / one-liners — same progress interaction as Practice MCQ.
 * Content from pearl_points + open_pearl; progress via Data Spine store.
 */
export function PearlPracticeSession({
  items,
  subjects,
  studentId,
  backHref = "/pearl-points",
}: {
  items: PearlCatalogItem[];
  subjects: { id: string; name: string }[];
  studentId: string;
  backHref?: string;
}) {
  const supabase = useRef(createClient()).current;
  const [subjectId, setSubjectId] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [payload, setPayload] = useState<{
    answer: string;
    explanation: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const sessionIdRef = useRef<string | null>(null);

  const scoped = useMemo(
    () => (subjectId ? items.filter((p) => p.subject_id === subjectId) : items),
    [items, subjectId]
  );
  const itemIds = useMemo(() => scoped.map((p) => p.id), [scoped]);
  const byId = useMemo(() => new Map(scoped.map((p) => [p.id, p])), [scoped]);
  const subjectIds = useMemo(() => {
    if (subjectId) return [subjectId];
    return [...new Set(scoped.map((p) => p.subject_id).filter(Boolean))];
  }, [subjectId, scoped]);

  const store = useMemo(
    () =>
      createSpineProgressStore({
        supabase,
        subjectIds,
        studentId,
      }),
    [supabase, subjectIds, studentId]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sid = subjectId || subjectIds[0] || null;
      const sessionId = await startPracticeSessionRpc(supabase, sid);
      if (!cancelled) sessionIdRef.current = sessionId;
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, subjectId, subjectIds]);

  const deck = usePracticeDeckController({
    studentId,
    itemKind: "pearl",
    itemIds,
    store,
    shuffle,
  });

  const currentMeta = deck.current ? byId.get(deck.current.itemId) ?? null : null;

  function onNavigate(direction: "next" | "previous") {
    setRevealed(false);
    setPayload(null);
    deck.go(direction);
  }

  function reveal() {
    if (!currentMeta?.accessible || !deck.current) return;
    startTransition(async () => {
      const result = await openPearl(currentMeta.id);
      if ("error" in result && result.error) {
        toast.error(studyErrorMessage(result.error));
        return;
      }
      const pearl = "pearl" in result ? result.pearl : null;
      setPayload({
        answer: String(pearl?.answer ?? ""),
        explanation: String(pearl?.explanation ?? ""),
      });
      setRevealed(true);
      await deck.markDoneAndRecord(null);
    });
  }

  function endAndReport() {
    const durationMs = deck.timeTakenMs;
    const counts = {
      practiced: deck.stats.practiced,
      correct: deck.stats.correct,
    };
    deck.endSession();
    const sid = sessionIdRef.current;
    if (sid) {
      void endPracticeSessionRpc(supabase, {
        sessionId: sid,
        durationMs,
        counts,
      });
    }
  }

  if (items.length === 0) return null;

  if (deck.ended && deck.report) {
    return (
      <PracticeSessionReportCard
        title="Pearl Points"
        report={deck.report}
        backHref={backHref}
        backLabel="Back to Pearl Points"
        variant="pearl"
      />
    );
  }

  if (!deck.hydrated) {
    return (
      <p className="text-sm text-muted-foreground">Loading pearl deck…</p>
    );
  }

  const positionLabel =
    deck.filtered.length === 0
      ? "No items in this filter"
      : `${deck.index + 1} of ${deck.filtered.length}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Subject</span>
          <select
            className="h-9 rounded-xl border border-[var(--student-ink)]/15 bg-background px-2"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setRevealed(false);
              setPayload(null);
            }}
          >
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PracticeSessionChrome
        eyebrow="Pearl Points"
        title="One-liners"
        positionLabel={positionLabel}
        elapsedMs={deck.timeTakenMs}
        completionPercent={deck.completion}
        filter={deck.filter}
        counts={deck.counts}
        onFilterChange={(f) => {
          setRevealed(false);
          setPayload(null);
          deck.changeFilter(f);
        }}
        marked={deck.current?.marked ?? false}
        onToggleMark={() => void deck.toggleMark()}
        onResetDone={() => {
          setRevealed(false);
          setPayload(null);
          void deck.resetDone();
        }}
        onEnd={endAndReport}
        canGoPrev={deck.index > 0}
        canGoNext={deck.index < deck.filtered.length - 1}
        onPrev={() => onNavigate("previous")}
        onNext={() => onNavigate("next")}
        shuffleControl={
          <Button
            type="button"
            size="sm"
            variant={shuffle ? "default" : "outline"}
            onClick={() => {
              setShuffle((v) => !v);
              setRevealed(false);
              setPayload(null);
            }}
            data-testid="pearl-shuffle"
          >
            {shuffle ? "Shuffled" : "Shuffle"}
          </Button>
        }
      >
        {!deck.current || !currentMeta ? (
          <div className="rounded-3xl border border-dashed border-[var(--student-ink)]/15 p-8 text-center text-sm text-muted-foreground">
            Nothing matches this filter. Try All or Remaining, or reset Done items.
          </div>
        ) : (
          <article
            className="grid gap-4 rounded-3xl border border-[var(--student-ink)]/10 bg-card p-4 sm:p-6"
            data-testid="pearl-card"
          >
            {currentMeta.subject_name ? (
              <p className="text-xs font-medium tracking-wide text-[var(--student-ink)]/55 uppercase">
                {currentMeta.subject_name}
              </p>
            ) : null}
            <p className="font-heading text-lg leading-relaxed font-medium text-[var(--student-ink)]">
              {currentMeta.prompt}
            </p>
            {!currentMeta.accessible && <ResourceLockNotice />}
            {currentMeta.accessible && revealed && payload && (
              <div
                className="rounded-2xl bg-[var(--student-ink)]/5 p-4"
                data-testid="pearl-answer"
              >
                <p className="text-sm font-semibold tracking-wide text-[var(--brand-teal-ink)] uppercase">
                  Answer
                </p>
                <p className="mt-1 text-base font-medium text-[var(--student-ink)]">
                  {payload.answer}
                </p>
                {payload.explanation ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {payload.explanation}
                  </p>
                ) : null}
              </div>
            )}
            {currentMeta.accessible && !revealed && (
              <Button
                type="button"
                data-testid="pearl-reveal"
                disabled={pending}
                onClick={reveal}
                className="w-full sm:w-fit"
              >
                {pending ? "Loading…" : "Reveal answer"}
              </Button>
            )}
          </article>
        )}
      </PracticeSessionChrome>
    </div>
  );
}
