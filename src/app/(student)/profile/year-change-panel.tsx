"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createYearChangeRequest,
  updatePendingYearChangeRequest,
} from "@/lib/actions/year-changes";
import {
  canStudentSubmitYearChange,
  yearChangeErrorMessage,
  yearChangeStatusLabel,
} from "@/lib/year-changes/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export type YearOption = { id: string; year_number: number; name: string };

export type YearChangeRequestView = {
  id: string;
  status: string;
  reason: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  from_year_id: string;
  to_year_id: string;
  from_name: string | null;
  to_name: string | null;
};

export function YearChangePanel({
  currentYearId,
  currentYearName,
  years,
  pending,
  latestRejected,
}: {
  currentYearId: string | null;
  currentYearName: string | null;
  years: YearOption[];
  pending: YearChangeRequestView | null;
  latestRejected: YearChangeRequestView | null;
}) {
  const [pendingTx, startTransition] = useTransition();
  const [toYearId, setToYearId] = useState(
    pending?.to_year_id ??
      years.find((y) => y.id !== currentYearId)?.id ??
      ""
  );
  const [reason, setReason] = useState(pending?.reason ?? "");

  const canSubmit = canStudentSubmitYearChange({
    hasActiveEnrollment: Boolean(currentYearId),
    hasPendingRequest: Boolean(pending),
  });

  const otherYears = years.filter((y) => y.id !== currentYearId);

  function submitNew() {
    if (!toYearId) {
      toast.error("Select a year.");
      return;
    }
    startTransition(async () => {
      const res = await createYearChangeRequest(toYearId, reason.trim() || null);
      if ("error" in res && res.error) {
        toast.error(yearChangeErrorMessage(res.error));
      } else {
        toast.success("Year-change request submitted");
      }
    });
  }

  function savePending() {
    if (!pending) return;
    startTransition(async () => {
      const res = await updatePendingYearChangeRequest(
        pending.id,
        toYearId || null,
        reason
      );
      if (res.error) toast.error(yearChangeErrorMessage(res.error));
      else toast.success("Request updated");
    });
  }

  return (
    <div className="grid gap-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Current academic year</span>
        <span className="font-medium">{currentYearName ?? "—"}</span>
      </div>

      {pending && (
        <div className="grid gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>pending</Badge>
            <span>
              Requested: {pending.to_name ?? "—"} (from{" "}
              {pending.from_name ?? "—"})
            </span>
          </div>
          <p className="text-muted-foreground">
            {yearChangeStatusLabel(pending.status)}. You can update the
            requested year or reason while it is pending.
          </p>
        </div>
      )}

      {!pending && latestRejected && (
        <div className="grid gap-1 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">rejected</Badge>
            <span>
              Last request: {latestRejected.to_name ?? "—"}
            </span>
          </div>
          {latestRejected.review_note && (
            <p className="text-muted-foreground">
              Admin note: {latestRejected.review_note}
            </p>
          )}
          <p className="text-muted-foreground">
            You can submit a new request below.
          </p>
        </div>
      )}

      {(canSubmit || pending) && otherYears.length > 0 && (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="to-year">Requested year</Label>
            <select
              id="to-year"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={toYearId}
              disabled={pendingTx}
              onChange={(e) => setToYearId(e.target.value)}
            >
              <option value="" disabled>
                Select year…
              </option>
              {otherYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="yc-reason">Reason (optional)</Label>
            <Input
              id="yc-reason"
              value={reason}
              disabled={pendingTx}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why do you need this change?"
            />
          </div>
          {pending ? (
            <Button
              type="button"
              disabled={pendingTx || !toYearId}
              onClick={savePending}
              className="w-fit"
            >
              {pendingTx ? "Saving…" : "Update request"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={pendingTx || !toYearId}
              onClick={submitNew}
              className="w-fit"
            >
              {pendingTx ? "Submitting…" : "Request year change"}
            </Button>
          )}
        </div>
      )}

      {!currentYearId && (
        <p className="text-muted-foreground">
          You need an active class enrollment before requesting a year change.
        </p>
      )}

      {currentYearId && otherYears.length === 0 && (
        <p className="text-muted-foreground">No other years are available.</p>
      )}
    </div>
  );
}
