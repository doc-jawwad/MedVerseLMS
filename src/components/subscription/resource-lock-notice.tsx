import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Visual lock affordance for catalog items the DB already marked inaccessible.
 * Authorization remains RPC/RLS — this is UX only.
 */
export function ResourceLockNotice({
  compact = false,
}: {
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">locked</Badge>
        <Button asChild size="sm" variant="secondary">
          <Link href="/subscription">Get Subscription</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Badge variant="outline" className="w-fit">
        locked
      </Badge>
      <p className="text-sm text-muted-foreground">
        An active subscription is required to open this. Free resources stay
        available without a subscription.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/subscription">Get Subscription</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/subscription#contact-admin">Contact Admin</Link>
        </Button>
      </div>
    </div>
  );
}
