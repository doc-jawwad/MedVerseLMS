"use client";

import { formatElapsed } from "@/lib/practice/timer";

export function PracticeTimer({
  elapsedMs,
  label = "Time",
}: {
  elapsedMs: number;
  label?: string;
}) {
  return (
    <div
      className="inline-flex items-baseline gap-1.5 rounded-full bg-brand/12 px-3 py-1 tabular-nums"
      aria-live="polite"
      aria-label={`${label} ${formatElapsed(elapsedMs)}`}
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] text-brand-ink uppercase">
        {label}
      </span>
      <span className="font-heading text-sm font-semibold text-ink">
        {formatElapsed(elapsedMs)}
      </span>
    </div>
  );
}
