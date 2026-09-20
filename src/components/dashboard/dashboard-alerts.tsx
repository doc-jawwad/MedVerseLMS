import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DashboardAlert } from "@/lib/dashboard/build-alerts";

export function DashboardAlerts({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="grid gap-2" data-testid="dashboard-alerts">
      {alerts.map((alert) => (
        <Alert
          key={alert.id}
          variant={alert.tone === "warning" ? "destructive" : "default"}
        >
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{alert.body}</span>
            {alert.href && alert.ctaLabel ? (
              <Button asChild size="sm" variant="secondary" className="w-fit">
                <Link href={alert.href}>{alert.ctaLabel}</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
