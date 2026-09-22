import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Premium metric tile for dashboards — navy ink value, teal accent rule.
 */
export function MetricCard({
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
    <Card
      className={cn(
        "surface-card gap-0 overflow-hidden border-border/80 py-0 shadow-none",
        className
      )}
    >
      <CardHeader className="gap-2 px-4 py-4">
        <CardDescription className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {label}
        </CardDescription>
        <div className="brand-rule" aria-hidden />
        <CardTitle className="metric-value font-heading text-2xl font-semibold tracking-tight text-[var(--student-ink)] sm:text-[1.65rem]">
          {value}
        </CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}
