"use client";

import { Progress } from "@/components/ui/progress";

export function PracticeCompletionMeter({
  percent,
  label = "Session progress",
}: {
  percent: number;
  label?: string;
}) {
  const safe = Math.max(0, Math.min(100, percent));
  return (
    <div className="grid gap-1.5" data-testid="practice-completion-meter">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-[var(--student-ink)]/70">{label}</span>
        <span
          className="tabular-nums font-semibold text-[var(--student-ink)]"
          data-testid="practice-completion-percent"
        >
          {safe}%
        </span>
      </div>
      <Progress value={safe} className="h-1.5 bg-muted" />
    </div>
  );
}
