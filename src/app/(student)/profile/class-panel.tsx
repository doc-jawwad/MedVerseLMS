"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { selfChangeClassAction } from "@/lib/actions/profile";
import {
  classLockBadgeLabel,
  classLockExplanation,
  classLockHeadline,
  profileErrorMessage,
} from "@/lib/profile/presentation";
import type { ClassLockState, YearOption } from "@/lib/profile/types";
import {
  YearChangePanel,
  type YearChangeRequestView,
} from "./year-change-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ClassPanel({
  lock,
  years,
  pending,
  latestRejected,
}: {
  lock: ClassLockState;
  years: YearOption[];
  pending: YearChangeRequestView | null;
  latestRejected: YearChangeRequestView | null;
}) {
  const [pendingTx, startTransition] = useTransition();
  const [selectedYearId, setSelectedYearId] = useState(
    lock.year_id ?? years[0]?.id ?? ""
  );

  const otherYears = years.filter((y) => y.id !== lock.year_id);

  function saveFreeChange() {
    if (!selectedYearId || selectedYearId === lock.year_id) {
      toast.error("Select a different class.");
      return;
    }
    startTransition(async () => {
      const res = await selfChangeClassAction(selectedYearId);
      if (!res.ok) toast.error(profileErrorMessage(res.error));
      else toast.success("Class updated");
    });
  }

  return (
    <div className="grid gap-4 text-sm">
      <div className="rounded-md border border-border bg-muted/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={lock.can_self_change ? "outline" : "default"}>
            {classLockBadgeLabel(lock.lock)}
          </Badge>
        </div>
        <p className="mt-2 text-base font-semibold text-[var(--student-ink)]">
          {classLockHeadline(lock)}
        </p>
        <p className="mt-1 text-muted-foreground">
          {classLockExplanation(lock.lock)}
        </p>
      </div>

      {lock.can_self_change ? (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="free-class">Change class</Label>
            <select
              id="free-class"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={selectedYearId}
              disabled={pendingTx || otherYears.length === 0}
              onChange={(e) => setSelectedYearId(e.target.value)}
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            disabled={
              pendingTx ||
              !selectedYearId ||
              selectedYearId === lock.year_id ||
              otherYears.length === 0
            }
            onClick={saveFreeChange}
            className="w-fit"
          >
            {pendingTx ? "Updating…" : "Update class"}
          </Button>
          {otherYears.length === 0 && (
            <p className="text-muted-foreground">No other classes available.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="locked-class">Current class</Label>
            <select
              id="locked-class"
              className="h-9 w-full cursor-not-allowed rounded-md border bg-muted/40 px-3 text-sm text-foreground"
              value={lock.year_id ?? ""}
              disabled
              aria-disabled="true"
              title={classLockHeadline(lock)}
            >
              <option value={lock.year_id ?? ""}>
                {lock.year_name ?? "—"}
              </option>
            </select>
            <p className="text-xs text-muted-foreground">
              Locked on purpose — not broken. Use an admin-approved class change
              below if you need a different year.
            </p>
          </div>
          <YearChangePanel
            currentYearId={lock.year_id}
            currentYearName={lock.year_name}
            years={years}
            pending={pending}
            latestRejected={latestRejected}
          />
        </div>
      )}
    </div>
  );
}
