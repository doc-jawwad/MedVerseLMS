"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  approveSubscriptionApplication,
  rejectSubscriptionApplication,
  getPaymentScreenshotReadUrl,
} from "@/lib/actions/subscription-applications";
import { adminSubscriptionErrorMessage } from "@/lib/subscriptions/admin-errors";
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

type Props = {
  applicationId: string;
  status: string;
  canApprove: boolean;
  canReview: boolean;
};

export function ApplicationActions({
  applicationId,
  status,
  canApprove,
  canReview,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  if (status !== "pending" && !canReview) return null;

  async function openScreenshot() {
    if (!canReview) {
      toast.error(adminSubscriptionErrorMessage("permission_denied"));
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewUrl(null);
    const res = await getPaymentScreenshotReadUrl(applicationId);
    setPreviewLoading(false);
    if ("error" in res) {
      toast.error(adminSubscriptionErrorMessage(res.error));
      setPreviewOpen(false);
      return;
    }
    setPreviewUrl(res.url);
  }

  function submit() {
    if (!mode) return;
    const reviewNote = note.trim() || null;
    setMode(null);
    startTransition(async () => {
      const res =
        mode === "approve"
          ? await approveSubscriptionApplication(applicationId, reviewNote)
          : await rejectSubscriptionApplication(applicationId, reviewNote);
      if (res.error) toast.error(adminSubscriptionErrorMessage(res.error));
      else
        toast.success(
          mode === "approve" ? "Application approved" : "Application rejected"
        );
      setNote("");
    });
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {canReview && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void openScreenshot()}
          >
            Screenshot
          </Button>
        )}
        {status === "pending" && canApprove && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => setMode("approve")}
          >
            Approve
          </Button>
        )}
        {status === "pending" && canReview && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => setMode("reject")}
          >
            Reject
          </Button>
        )}
      </div>

      <Dialog open={mode != null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "approve" ? "Approve application" : "Reject application"}
            </DialogTitle>
            <DialogDescription>
              {mode === "approve"
                ? "This activates or extends the student subscription using the existing RPC rules. Account status is not changed."
                : "The student can submit a new application afterward. This historical row is kept."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="review-note">Review note (optional)</Label>
            <Input
              id="review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Visible to the student if rejected"
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
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment screenshot</DialogTitle>
            <DialogDescription>
              Short-lived authorized link. Not a public URL.
            </DialogDescription>
          </DialogHeader>
          {previewLoading && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Payment proof"
              className="max-h-[70vh] w-full rounded-md border object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
