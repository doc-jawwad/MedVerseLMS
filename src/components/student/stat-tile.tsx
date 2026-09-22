import { MetricCard } from "@/components/student/metric-card";

/** @deprecated Prefer MetricCard — kept as a thin alias for existing call sites. */
export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <MetricCard label={label} value={value} hint={hint} className={className} />
  );
}
