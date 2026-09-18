import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Locked paid-test review chrome. Must only render when the RPC returned
 * review_locked_entitlement with no items — this is UX, not authorization.
 */
export function ReviewLockNotice() {
  return (
    <div
      className="relative overflow-hidden rounded-xl border"
      data-testid="review-locked-entitlement"
    >
      <div
        aria-hidden
        className="pointer-events-none select-none blur-sm"
        data-testid="review-lock-blur"
      >
        <div className="grid gap-2 p-6 opacity-40">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-10 rounded border bg-background" />
          <div className="h-10 rounded border bg-background" />
          <div className="h-16 rounded bg-muted" />
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/70 p-6">
        <div className="grid max-w-md gap-3 text-center">
          <Badge variant="outline" className="mx-auto w-fit">
            Review locked
          </Badge>
          <p className="text-sm text-muted-foreground">
            Your score is saved. Question review, your submitted answers, and
            explanations require an active subscription.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/subscription" data-testid="review-lock-cta">
                Get Subscription
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/subscription#contact-admin">Contact Admin</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
