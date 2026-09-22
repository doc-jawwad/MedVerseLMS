import Link from "next/link";
import { cn } from "@/lib/utils";

/** Compact recent-activity / list row for dashboards. */
export function ActivityItem({
  href,
  title,
  meta,
  trailing,
  className,
}: {
  href?: string;
  title: string;
  meta?: string;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-2.5 transition-colors",
        href && "hover:border-[var(--brand-teal)]/35 hover:bg-accent/30",
        className
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-[var(--student-ink)]">{title}</p>
        {meta ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
