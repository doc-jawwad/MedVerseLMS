"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { McqFolderProgressRing } from "@/components/library/mcq-folder-progress-ring";
import {
  restartMcqBankFolderPractice,
  restartMcqBankSubfolderPractice,
} from "@/lib/actions/mcq-bank-folder-practice";
import {
  toContainerPracticeProgress,
  type McqBankContainerPracticeProgress,
  type McqBankFolderPracticeProgress,
  type McqBankSubfolderPracticeProgress,
} from "@/lib/practice/mcq-bank-folder-progress";
import { MCQ_FOLDER_PRACTICE_BATCH_SIZE } from "@/lib/practice/session-labels";

type ContainerKind = "folder" | "subfolder";

function scopeFor(
  kind: ContainerKind,
  mode: "all" | "favorites" | "incorrect"
): string {
  if (kind === "subfolder") {
    if (mode === "favorites") return "mcq_bank_subfolder_favorites";
    if (mode === "incorrect") return "mcq_bank_subfolder_incorrect";
    return "mcq_bank_subfolder";
  }
  if (mode === "favorites") return "mcq_bank_folder_favorites";
  if (mode === "incorrect") return "mcq_bank_folder_incorrect";
  return "mcq_bank_folder";
}

export function McqPracticePanel({
  containerKind,
  containerId,
  containerName,
  progress: rawProgress,
}: {
  containerKind: ContainerKind;
  containerId: string;
  containerName: string;
  progress:
    | McqBankContainerPracticeProgress
    | McqBankFolderPracticeProgress
    | McqBankSubfolderPracticeProgress;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const progress = toContainerPracticeProgress(rawProgress);
  const noun = containerKind === "subfolder" ? "subfolder" : "folder";

  const sessionHref = `/practice/session?scope=${scopeFor(containerKind, "all")}&id=${encodeURIComponent(containerId)}&name=${encodeURIComponent(containerName)}`;
  const favoritesHref = `/practice/session?scope=${scopeFor(containerKind, "favorites")}&id=${encodeURIComponent(containerId)}&name=${encodeURIComponent(`${containerName} · Favorites`)}`;
  const incorrectHref = `/practice/session?scope=${scopeFor(containerKind, "incorrect")}&id=${encodeURIComponent(containerId)}&name=${encodeURIComponent(`${containerName} · Incorrect`)}`;

  function restartAndStart() {
    startTransition(async () => {
      const res =
        containerKind === "subfolder"
          ? await restartMcqBankSubfolderPractice(containerId)
          : await restartMcqBankFolderPractice(containerId);
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
        No approved MCQs in this {noun} yet.
      </p>
    );
  }

  const favoritesAction =
    progress.favorites > 0 ? (
      <Button
        asChild
        variant="outline"
        data-testid={`mcq-${containerKind}-practice-favorites`}
      >
        <Link href={favoritesHref}>
          Practice Favorites ({progress.favorites})
        </Link>
      </Button>
    ) : (
      <p
        className="text-sm text-muted-foreground"
        data-testid={`mcq-${containerKind}-favorites-empty`}
      >
        No favorites yet. Favorite an MCQ during practice to build this set.
      </p>
    );

  const incorrectAction =
    progress.incorrect > 0 ? (
      <Button
        asChild
        variant="outline"
        data-testid={`mcq-${containerKind}-practice-incorrect`}
      >
        <Link href={incorrectHref}>
          Practice Incorrect ({progress.incorrect})
        </Link>
      </Button>
    ) : (
      <p
        className="text-sm text-muted-foreground"
        data-testid={`mcq-${containerKind}-incorrect-empty`}
      >
        No incorrect MCQs. Wrong answers during practice appear here until you
        get them right.
      </p>
    );

  const setActions = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>{favoritesAction}</div>
      <div>{incorrectAction}</div>
    </div>
  );

  if (progress.complete) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <McqFolderProgressRing done={progress.done} total={progress.total} />
            <div className="min-w-0">
              <p className="font-medium text-[var(--student-ink)]">
                {containerKind === "subfolder"
                  ? "Subfolder complete"
                  : "Folder complete"}
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
            data-testid={`mcq-${containerKind}-restart-practice`}
          >
            {pending ? "Restarting…" : "Restart Practice"}
          </Button>
        </div>
        <div className="border-t pt-4">{setActions}</div>
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
              {progress.remaining} remaining
              {progress.remaining > MCQ_FOLDER_PRACTICE_BATCH_SIZE
                ? ` · practice loads up to ${MCQ_FOLDER_PRACTICE_BATCH_SIZE} unfinished MCQs per round`
                : " · practice serves unfinished MCQs first"}
            </p>
          </div>
        </div>
        <Button asChild data-testid={`mcq-${containerKind}-start-practice`}>
          <Link href={sessionHref}>Start practice</Link>
        </Button>
      </div>
      <div className="border-t pt-4">{setActions}</div>
    </div>
  );
}

/** @deprecated Prefer McqPracticePanel with containerKind="folder". */
export function McqFolderPracticePanel({
  folderId,
  folderName,
  progress,
}: {
  folderId: string;
  folderName: string;
  progress: McqBankFolderPracticeProgress;
}) {
  return (
    <McqPracticePanel
      containerKind="folder"
      containerId={folderId}
      containerName={folderName}
      progress={progress}
    />
  );
}
