"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { McqFolderProgressRing } from "@/components/library/mcq-folder-progress-ring";
import { restartMcqBankFolderPractice } from "@/lib/actions/mcq-bank-folder-practice";
import type { McqBankFolderPracticeProgress } from "@/lib/practice/mcq-bank-folder-progress";

export function McqFolderPracticePanel({
  folderId,
  folderName,
  progress,
}: {
  folderId: string;
  folderName: string;
  progress: McqBankFolderPracticeProgress;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sessionHref = `/practice/session?scope=mcq_bank_folder&id=${encodeURIComponent(folderId)}&name=${encodeURIComponent(folderName)}`;
  const favoritesHref = `/practice/session?scope=mcq_bank_folder_favorites&id=${encodeURIComponent(folderId)}&name=${encodeURIComponent(`${folderName} · Favorites`)}`;

  function restartAndStart() {
    startTransition(async () => {
      const res = await restartMcqBankFolderPractice(folderId);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Practice restarted");
      router.push(sessionHref);
      router.refresh();
    });
  }

  if (progress.total <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No approved MCQs in this folder yet.
      </p>
    );
  }

  const favoritesAction =
    progress.favorites > 0 ? (
      <Button asChild variant="outline" data-testid="mcq-folder-practice-favorites">
        <Link href={favoritesHref}>
          Practice Favorites ({progress.favorites})
        </Link>
      </Button>
    ) : (
      <p
        className="text-sm text-muted-foreground"
        data-testid="mcq-folder-favorites-empty"
      >
        No favorites yet. Favorite an MCQ during practice to build this set.
      </p>
    );

  if (progress.complete) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <McqFolderProgressRing done={progress.done} total={progress.total} />
            <div className="min-w-0">
              <p className="font-medium text-[var(--student-ink)]">
                Folder complete
              </p>
              <p className="text-sm text-muted-foreground">
                You finished all {progress.total} MCQs. Start again only when you
                choose Restart Practice.
              </p>
            </div>
          </div>
          <Button
            type="button"
            disabled={pending}
            onClick={restartAndStart}
            data-testid="mcq-folder-restart-practice"
          >
            {pending ? "Restarting…" : "Restart Practice"}
          </Button>
        </div>
        <div className="border-t pt-4">{favoritesAction}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <McqFolderProgressRing done={progress.done} total={progress.total} />
          <div className="min-w-0">
            <p className="font-medium text-[var(--student-ink)]">
              {progress.done} of {progress.total} complete
            </p>
            <p className="text-sm text-muted-foreground">
              {progress.remaining} remaining · practice serves unfinished MCQs
              first
            </p>
          </div>
        </div>
        <Button asChild data-testid="mcq-folder-start-practice">
          <Link href={sessionHref}>Start practice</Link>
        </Button>
      </div>
      <div className="border-t pt-4">{favoritesAction}</div>
    </div>
  );
}
