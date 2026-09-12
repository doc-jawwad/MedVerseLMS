"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setQuestionStatus } from "@/lib/actions/questions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
    <div className="flex items-center gap-2">
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
    </div>
  );
}
