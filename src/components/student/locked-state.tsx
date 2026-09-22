import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/student/status-badge";

/**
 * UX-only locked surface. Authorization remains RPC/RLS.
 */
export function LockedState({
  title = "Subscription required",
  description = "An active subscription is required to open this. Free resources stay available without a subscription.",
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="muted">
          <Lock className="mr-1 inline size-3" aria-hidden />
          locked
        </StatusBadge>
        <Button asChild size="sm" variant="secondary">
          <Link href="/subscription">Get Subscription</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-border/80 bg-card/70 p-4">
      <StatusBadge tone="muted" className="w-fit">
        <Lock className="mr-1 inline size-3" aria-hidden />
        locked
      </StatusBadge>
      <div>
        <p className="font-heading text-sm font-semibold text-[var(--student-ink)]">
          {title}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/subscription">Get Subscription</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/contact">Contact MedVerse</Link>
        </Button>
      </div>
    </div>
  );
}
