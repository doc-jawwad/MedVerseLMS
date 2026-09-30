import { folderPracticeProgressLabel } from "@/lib/practice/mcq-bank-folder-progress";

/** Circular folder progress: completed / total MCQs. */
export function McqFolderProgressRing({
  done,
  total,
  size = 56,
  className,
}: {
  done: number;
  total: number;
  size?: number;
  className?: string;
}) {
  const safeTotal = Math.max(0, total);
  const safeDone = Math.max(0, Math.min(safeTotal, done));
  const percent =
    safeTotal <= 0 || safeDone <= 0
      ? 0
      : Math.round((100 * safeDone) / safeTotal);
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  const label = folderPracticeProgressLabel({
    done: safeDone,
    total: safeTotal,
  });

  return (
    <div
      className={`relative ${className ?? ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label} MCQs complete (${percent}%)`}
    >
      <svg width={size} height={size} className="block -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted/40"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="text-[var(--brand-teal)] transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex rotate-0 items-center justify-center">
        <span className="text-[10px] font-semibold tabular-nums text-[var(--student-ink)] sm:text-xs">
          {label}
        </span>
      </div>
    </div>
  );
}
