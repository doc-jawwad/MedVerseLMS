import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const TONE_CLASS = {
  default: "",
  success: "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  warning: "border-amber-600/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-[var(--brand-teal)]/35 bg-[var(--brand-teal)]/10 text-[var(--brand-teal-ink)]",
  muted: "border-border bg-muted/60 text-muted-foreground",
} as const;

export type StatusTone = keyof typeof TONE_CLASS;

/** Compact semantic status chip for dashboards and tables. */
export function StatusBadge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </Badge>
  );
}
