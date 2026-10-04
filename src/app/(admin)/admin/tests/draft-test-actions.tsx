"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteDraftTest } from "@/lib/actions/tests";
import { draftTestErrorMessage } from "@/lib/tests/draft-test-errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DraftTestEditLink({
  testId,
  className,
}: {
  testId: string;
  className?: string;
}) {
  return (
    <Button asChild size="sm" variant="outline" className={className}>
      <Link href={`/admin/tests/${testId}`} data-testid={`edit-draft-test-${testId}`}>
        Edit
      </Link>
    </Button>
  );
}

export function DraftTestDeleteButton({
  testId,
  title,
  redirectToList = false,
}: {
  testId: string;
  title: string;
  /** After delete from the builder page, leave the removed route. */
  redirectToList?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        data-testid={`delete-draft-test-${testId}`}
        onClick={() => setConfirm(true)}
      >
        Delete
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this draft test?</DialogTitle>
            <DialogDescription>
              “{title}” will be permanently removed, including its draft question
              list and audience settings. Published tests cannot be deleted this
              way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              data-testid={`confirm-delete-draft-test-${testId}`}
              onClick={() => {
                setConfirm(false);
                startTransition(async () => {
                  const res = await deleteDraftTest(testId);
                  if (res.error) {
                    toast.error(draftTestErrorMessage(res.error));
                    return;
                  }
                  toast.success("Draft deleted");
                  if (redirectToList) router.push("/admin/tests");
                  else router.refresh();
                });
              }}
            >
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
