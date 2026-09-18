"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  approveYearChangeRequest,
  rejectYearChangeRequest,
} from "@/lib/actions/year-changes";
import { yearChangeErrorMessage } from "@/lib/year-changes/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function YearChangeActions({
  requestId,
  canManage,
}: {
  requestId: string;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  if (!canManage) return null;

  function submit() {
    if (!mode) return;
    const reviewNote = note.trim() || null;
    const action = mode;
    setMode(null);
    startTransition(async () => {
      const res =
        action === "approve"
          ? await approveYearChangeRequest(requestId, reviewNote)
          : await rejectYearChangeRequest(requestId, reviewNote);
      if (res.error) toast.error(yearChangeErrorMessage(res.error));
      else
        toast.success(
          action === "approve" ? "Year change approved" : "Year change rejected"
        );
      setNote("");
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => setMode("approve")}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setMode("reject")}
        >
          Reject
        </Button>
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "approve" ? "Approve year change" : "Reject year change"}
            </DialogTitle>
            <DialogDescription>
              {mode === "approve"
                ? "This expires the student’s current class enrollment and activates the requested year. Account status is not changed."
                : "The student can submit a new request after rejection."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="yc-note">Reviewer note (optional)</Label>
            <Input
              id="yc-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Shown to admins; included in audit details"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant={mode === "reject" ? "destructive" : "default"}
              onClick={submit}
            >
              {mode === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
