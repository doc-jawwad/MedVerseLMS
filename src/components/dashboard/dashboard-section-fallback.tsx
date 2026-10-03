import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SectionHeading } from "@/components/student/section-heading";

function Pulse({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-muted/70 ${className ?? ""}`}
      aria-hidden
    />
  );
}

/** Shared Suspense fallbacks sized to reduce CLS on mobile/desktop. */
export function DashboardLeaderboardFallback() {
  return (
    <Card
      className="surface-card border-border/80 shadow-none"
      data-testid="dashboard-leaderboard-fallback"
    >
      <CardHeader>
        <CardTitle className="font-heading text-base text-ink">
          Last test leaderboard
        </CardTitle>
        <CardDescription>Loading leaderboard…</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Pulse className="h-12 w-full" />
        <Pulse className="h-12 w-full" />
        <Pulse className="h-12 w-full" />
      </CardContent>
    </Card>
  );
}

export function DashboardHistoricalFallback() {
  return (
    <div className="grid gap-3" data-testid="dashboard-historical-fallback">
      <div className="grid gap-3">
        <SectionHeading
          title="Lifetime performance"
          description="Loading lifetime scores…"
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Pulse className="h-20 w-full" />
          <Pulse className="h-20 w-full" />
          <Pulse className="h-20 w-full" />
          <Pulse className="h-20 w-full" />
        </div>
      </div>
      <Card className="surface-card border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="font-heading text-base text-ink">
            Score overview
          </CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Pulse className="h-8 w-full" />
          <Pulse className="h-8 w-full" />
        </CardContent>
      </Card>
      <Card className="surface-card border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="font-heading text-base text-ink">
            Historical trend
          </CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
        <CardContent>
          <Pulse className="h-44 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function DashboardPaidFallback() {
  return (
    <Card
      className="surface-card border-border/80 shadow-none"
      data-testid="dashboard-paid-fallback"
    >
      <CardHeader>
        <CardTitle className="font-heading text-base text-ink">
          Subject performance
        </CardTitle>
        <CardDescription>Loading paid analytics…</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Pulse className="h-16 w-full" />
        <Pulse className="h-16 w-full" />
      </CardContent>
    </Card>
  );
}

export function DashboardRecentFallback() {
  return (
    <Card
      className="surface-card border-border/80 shadow-none"
      data-testid="dashboard-recent-fallback"
    >
      <CardHeader>
        <CardTitle className="font-heading text-base text-ink">
          Recent tests
        </CardTitle>
        <CardDescription>Loading history…</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Pulse className="h-12 w-full" />
        <Pulse className="h-12 w-full" />
      </CardContent>
    </Card>
  );
}
