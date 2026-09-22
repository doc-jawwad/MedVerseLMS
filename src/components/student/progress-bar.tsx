import { cn } from "@/lib/utils";

/** Lightweight CSS progress bar — no chart libraries. */
export function ProgressBar({
  value,
  max = 100,
  label,
  className,
  showValue = true,
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
  showValue?: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  return (
    <div className={cn("grid gap-1", className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          {label ? (
            <span className="font-medium text-[var(--student-ink)]">{label}</span>
          ) : (
            <span />
          )}
          {showValue ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(pct)}%
            </span>
          ) : null}
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--brand-navy)] to-[var(--brand-teal)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
