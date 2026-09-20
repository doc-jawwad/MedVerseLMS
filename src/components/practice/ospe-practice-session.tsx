"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { openOspeStation } from "@/lib/actions/ospe-stations";
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

export type OspeCatalogItem = {
  id: string;
  title: string;
  year_id: string;
  subject_id: string;
  sort_order: number;
  accessible: boolean;
  subject_name?: string | null;
};

function stationImageSrc(id: string) {
  return `/api/ospe-stations/${id}`;
}

/**
 * OSPE Practice — image + Reveal answer. Progress via Data Spine (item_kind=ospe).
 * Answer is never in catalog RSC; loaded only after open_ospe_station.
 */
export function OspePracticeSession({
  items,
  subjects,
  studentId,
  backHref = "/practice/ospe",
}: {
  items: OspeCatalogItem[];
  subjects: { id: string; name: string }[];
  studentId: string;
  backHref?: string;
}) {
  const supabase = useRef(createClient()).current;
  const [subjectId, setSubjectId] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [imageFailed, setImageFailed] = useState(false);
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
    itemKind: "ospe",
    itemIds,
    store,
    shuffle,
  });

  const currentMeta = deck.current
    ? (byId.get(deck.current.itemId) ?? null)
    : null;

  // Prefetch next entitled station image only (never answers).
  useEffect(() => {
    if (!deck.hydrated || deck.filtered.length === 0) return;
    const next = deck.filtered[deck.index + 1];
    if (!next) return;
    const meta = byId.get(next.itemId);
    if (!meta?.accessible) return;
    const img = new window.Image();
    img.src = stationImageSrc(meta.id);
  }, [deck.hydrated, deck.filtered, deck.index, byId]);

  function onNavigate(direction: "next" | "previous") {
    setRevealed(false);
    setAnswer(null);
    setImageFailed(false);
    deck.go(direction);
  }

  function reveal() {
    if (!currentMeta?.accessible || !deck.current) return;
    startTransition(async () => {
      const result = await openOspeStation(currentMeta.id);
      if ("error" in result && result.error) {
        toast.error(studyErrorMessage(result.error));
        return;
      }
      const station = "station" in result ? result.station : null;
      setAnswer(String(station?.answer ?? ""));
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
        title="OSPE Practice"
        report={deck.report}
        backHref={backHref}
        backLabel="Back to OSPE Practice"
        variant="pearl"
      />
    );
  }

  if (!deck.hydrated) {
    return (
      <p className="text-sm text-muted-foreground">Loading OSPE stations…</p>
    );
  }

  const positionLabel =
    deck.filtered.length === 0
      ? "No items in this filter"
      : `${deck.index + 1} of ${deck.filtered.length}`;

  return (
    <div className="grid gap-4" data-testid="ospe-practice-session">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Block / subject</span>
          <select
            className="h-9 max-w-full rounded-xl border border-[var(--student-ink)]/15 bg-background px-2"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setRevealed(false);
              setAnswer(null);
              setImageFailed(false);
            }}
            data-testid="ospe-subject-filter"
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
        eyebrow="OSPE Practice"
        title="Stations"
        positionLabel={positionLabel}
        elapsedMs={deck.timeTakenMs}
        completionPercent={deck.completion}
        filter={deck.filter}
        counts={deck.counts}
        onFilterChange={(f) => {
          setRevealed(false);
          setAnswer(null);
          setImageFailed(false);
          deck.changeFilter(f);
        }}
        marked={deck.current?.marked ?? false}
        onToggleMark={() => void deck.toggleMark()}
        onResetDone={() => {
          setRevealed(false);
          setAnswer(null);
          setImageFailed(false);
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
              setAnswer(null);
              setImageFailed(false);
            }}
            data-testid="ospe-shuffle"
          >
            {shuffle ? "Shuffled" : "Shuffle"}
          </Button>
        }
      >
        {!deck.current || !currentMeta ? (
          <div className="rounded-3xl border border-dashed border-[var(--student-ink)]/15 p-8 text-center text-sm text-muted-foreground">
            Nothing matches this filter. Try All or Remaining, or reset Done
            items.
          </div>
        ) : (
          <article
            className="grid gap-4 rounded-3xl border border-[var(--student-ink)]/10 bg-card p-4 sm:p-6"
            data-testid="ospe-station-card"
            data-station-id={currentMeta.id}
            data-accessible={currentMeta.accessible ? "1" : "0"}
          >
            {currentMeta.subject_name ? (
              <p className="text-xs font-medium tracking-wide text-[var(--student-ink)]/55 uppercase">
                {currentMeta.subject_name}
              </p>
            ) : null}
            <h2
              className="font-heading text-lg leading-snug font-medium break-words text-[var(--student-ink)] sm:text-xl"
              data-testid="ospe-station-title"
            >
              {currentMeta.title}
            </h2>

            {!currentMeta.accessible && <ResourceLockNotice />}

            {currentMeta.accessible && (
              <div
                className="overflow-hidden rounded-2xl bg-[var(--student-ink)]/5"
                data-testid="ospe-station-image-wrap"
              >
                {!imageFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private streamed bytes, not a public CDN URL
                  <img
                    key={currentMeta.id}
                    src={stationImageSrc(currentMeta.id)}
                    alt={currentMeta.title}
                    className="mx-auto max-h-[min(70vh,560px)] w-full max-w-full object-contain"
                    data-testid="ospe-station-image"
                    onError={() => setImageFailed(true)}
                  />
                ) : (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    Image could not be loaded. Check access or try again.
                  </p>
                )}
              </div>
            )}

            {currentMeta.accessible && revealed && answer != null && (
              <div
                className="rounded-2xl bg-[var(--student-ink)]/5 p-4"
                data-testid="ospe-answer"
              >
                <p className="text-sm font-semibold tracking-wide text-[var(--brand-teal-ink)] uppercase">
                  Answer
                </p>
                <p className="mt-1 text-base font-medium break-words text-[var(--student-ink)]">
                  {answer}
                </p>
              </div>
            )}

            {currentMeta.accessible && !revealed && (
              <Button
                type="button"
                data-testid="ospe-reveal"
                disabled={pending}
                onClick={reveal}
                className="min-h-11 w-full sm:w-fit"
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
