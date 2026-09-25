"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  listQuestionUsages,
  moveQuestionToBin,
  setQuestionStatus,
  type QuestionUsage,
} from "@/lib/actions/questions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { purgeDateHint } from "@/components/admin/confirm-danger-dialog";

const transitions: Record<string, { to: string; label: string }[]> = {
  draft: [
    { to: "review", label: "Send to review" },
    { to: "approved", label: "Approve" },
    { to: "archived", label: "Archive" },
  ],
  review: [
    { to: "approved", label: "Approve" },
    { to: "needs_revision", label: "Needs revision" },
    { to: "archived", label: "Archive" },
  ],
  approved: [
    { to: "needs_revision", label: "Needs revision" },
    { to: "archived", label: "Archive" },
  ],
  needs_revision: [
    { to: "review", label: "Back to review" },
    { to: "approved", label: "Approve" },
    { to: "archived", label: "Archive" },
  ],
  archived: [{ to: "draft", label: "Restore to draft" }],
};

export function StatusControls({
  questionId,
  status,
}: {
  questionId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>{status.replace("_", " ")}</Badge>
      {(transitions[status] ?? []).map((t) => (
        <Button
          key={t.to}
          size="sm"
          variant={t.to === "approved" ? "default" : "outline"}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const { error } = await setQuestionStatus(questionId, status, t.to);
              if (error) toast.error(error);
              else {
                toast.success(t.label + " done");
                router.refresh();
              }
            })
          }
        >
          {t.label}
        </Button>
      ))}
      <MoveToBinWithUsageWarning
        questionId={questionId}
        disabled={pending}
        onSuccess={() => {
          router.push("/admin/questions");
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * Two-step bin confirm when the question is used (folder / Prof. Session / tests).
 */
function MoveToBinWithUsageWarning({
  questionId,
  disabled,
  onSuccess,
}: {
  questionId: string;
  disabled?: boolean;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"check" | "confirm">("check");
  const [usages, setUsages] = useState<QuestionUsage[]>([]);
  const [pending, startTransition] = useTransition();

  function reset() {
    setStep("check");
    setUsages([]);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function startCheck() {
    startTransition(async () => {
      const res = await listQuestionUsages(questionId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setUsages(res.usages);
      setStep("confirm");
    });
  }

  function confirmBin() {
    startTransition(async () => {
      const result = await moveQuestionToBin(questionId);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Moved to Bin");
      setOpen(false);
      reset();
      onSuccess();
    });
  }

  let body: ReactNode;
  if (step === "check") {
    body = (
      <>
        <div className="text-sm text-muted-foreground">
          <p>
            This hides the question from the Question Bank. Formal test history
            that already references it is preserved.
          </p>
          <p className="mt-2">
            Checking where this question is used before confirming…
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={startCheck}>
            {pending ? "Checking…" : "Continue"}
          </Button>
        </DialogFooter>
      </>
    );
  } else {
    body = (
      <>
        <div className="space-y-3 text-sm text-muted-foreground">
          {usages.length > 0 ? (
            <>
              <p>
                This question is still linked in the following places. Moving it
                to the Bin does not remove those links automatically.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-[var(--student-ink)]">
                {usages.map((u) => (
                  <li key={`${u.usage_kind}-${u.ref_id}`}>
                    {u.usage_label}
                  </li>
                ))}
              </ul>
              <p className="font-medium text-foreground">
                Confirm again to move to Bin anyway.
              </p>
            </>
          ) : (
            <p>
              This hides the question from the Question Bank. Formal test history
              that already references it is preserved.
            </p>
          )}
          <p>
            It stays in the Bin until about <strong>{purgeDateHint()}</strong>.
            This is not a permanent delete.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={confirmBin}>
            {pending ? "Moving…" : "Move to Bin"}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={disabled}
        >
          Move to Bin
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            {step === "check"
              ? "Move MCQ to Bin?"
              : usages.length > 0
                ? "Question is in use"
                : "Move MCQ to Bin?"}
          </DialogTitle>
          <DialogDescription>
            Soft-delete confirmation for this question.
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
