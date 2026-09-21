"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { moveQuestionToBin, setQuestionStatus } from "@/lib/actions/questions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConfirmDangerDialog,
  purgeDateHint,
} from "@/components/admin/confirm-danger-dialog";

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
      <ConfirmDangerDialog
        title="Move MCQ to Bin?"
        description={
          <>
            <p>
              This hides the question from the Question Bank. Formal test history
              that already references it is preserved.
            </p>
            <p className="mt-2">
              It stays in the Bin until about <strong>{purgeDateHint()}</strong>.
              This is not a permanent delete.
            </p>
          </>
        }
        confirmLabel="Move to Bin"
        trigger={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
          >
            Move to Bin
          </Button>
        }
        onConfirm={() => moveQuestionToBin(questionId)}
        onSuccess={() => {
          router.push("/admin/questions");
          router.refresh();
        }}
      />
    </div>
  );
}
