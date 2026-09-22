"use client";

import { Button } from "@/components/ui/button";
import { PracticeCompletionMeter } from "@/components/practice/practice-completion-meter";
import { PracticeFilterBar } from "@/components/practice/practice-filter-bar";
import { PracticeTimer } from "@/components/practice/practice-timer";
import type {
  PracticeFilter,
  PracticeFilterCounts,
} from "@/lib/practice/types";

export function PracticeSessionChrome({
  eyebrow,
  title,
  positionLabel,
  elapsedMs,
  completionPercent,
  filter,
  counts,
  onFilterChange,
  marked,
  onToggleMark,
  onResetDone,
  onEnd,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  children,
  shuffleControl,
}: {
  eyebrow: string;
  title: string;
  positionLabel: string;
  elapsedMs: number;
  completionPercent: number;
  filter: PracticeFilter;
  counts: PracticeFilterCounts;
  onFilterChange: (f: PracticeFilter) => void;
  marked: boolean;
  onToggleMark: () => void;
  onResetDone: () => void;
  onEnd: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  children: React.ReactNode;
  shuffleControl?: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 pb-8">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[var(--brand-teal-ink)] uppercase">
              {eyebrow}
            </p>
            <h1 className="font-heading text-xl font-semibold tracking-tight text-[var(--student-ink)] sm:text-2xl">
              {title}
            </h1>
            <div className="brand-rule mt-2" aria-hidden />
            <p className="mt-1.5 text-sm text-muted-foreground">{positionLabel}</p>
          </div>
          <PracticeTimer elapsedMs={elapsedMs} />
        </div>
        <PracticeCompletionMeter percent={completionPercent} />
        <PracticeFilterBar
          value={filter}
          counts={counts}
          onChange={onFilterChange}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={marked ? "default" : "outline"}
            onClick={onToggleMark}
            data-testid="practice-toggle-mark"
          >
            {marked ? "Marked" : "Mark"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onResetDone}
            disabled={counts.done === 0}
            data-testid="practice-reset-done"
          >
            Reset Done
          </Button>
          {shuffleControl}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={onEnd}
            data-testid="practice-end-session"
          >
            End session
          </Button>
        </div>
      </header>

      <div className="min-h-[280px]">{children}</div>

      <nav className="sticky bottom-3 z-10 flex gap-2 rounded-2xl border border-border bg-background/95 p-2 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/80">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={!canGoPrev}
          onClick={onPrev}
          data-testid="practice-prev"
        >
          Previous
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={!canGoNext}
          onClick={onNext}
          data-testid="practice-next"
        >
          Next
        </Button>
      </nav>
    </div>
  );
}
