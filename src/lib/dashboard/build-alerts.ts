/**
 * Dashboard alert strip — presentation only from known subscription /
 * catalog signals. No invented notifications store.
 */

import type { DashboardAccessKind } from "@/lib/tests/student-dashboard-presentation";

export type DashboardAlertTone = "info" | "warning" | "success";

export type DashboardAlert = {
  id: string;
  tone: DashboardAlertTone;
  title: string;
  body: string;
  href?: string;
  ctaLabel?: string;
};

export type IncomingAlertCandidate = {
  id: string;
  title: string;
  opens_at: string | null;
  state: string;
};

const SOON_MS = 24 * 60 * 60 * 1000;

export function buildDashboardAlerts(input: {
  accessKind: DashboardAccessKind;
  accessBanner: { title: string; description: string } | null;
  incoming: readonly IncomingAlertCandidate[];
  nowMs: number;
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  if (input.accessBanner) {
    const tone: DashboardAlertTone =
      input.accessKind === "expired" || input.accessKind === "deactivated"
        ? "warning"
        : "info";
    alerts.push({
      id: `access-${input.accessKind}`,
      tone,
      title: input.accessBanner.title,
      body: input.accessBanner.description,
      href:
        input.accessKind === "subscribed"
          ? undefined
          : "/subscription",
      ctaLabel:
        input.accessKind === "expired" || input.accessKind === "deactivated"
          ? "Renew subscription"
          : input.accessKind === "free" || input.accessKind === "pending"
            ? "My subscription"
            : undefined,
    });
  }

  for (const t of input.incoming) {
    if (t.state === "upcoming" && t.opens_at) {
      const opensMs = new Date(t.opens_at).getTime();
      if (
        Number.isFinite(opensMs) &&
        opensMs > input.nowMs &&
        opensMs - input.nowMs <= SOON_MS
      ) {
        alerts.push({
          id: `opens-soon-${t.id}`,
          tone: "info",
          title: "Test opens soon",
          body: `${t.title} opens within 24 hours.`,
          href: "/dashboard",
        });
      }
    }
    if (t.state === "available" || t.state === "in_progress") {
      alerts.push({
        id: `open-now-${t.id}`,
        tone: "success",
        title: t.state === "in_progress" ? "Resume your test" : "Test open now",
        body: t.title,
        href: `/tests/${t.id}/attempt`,
        ctaLabel: t.state === "in_progress" ? "Resume" : "Start",
      });
    }
  }

  return alerts;
}
