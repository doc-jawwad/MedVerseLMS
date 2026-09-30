"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { McqFolderProgressRing } from "@/components/library/mcq-folder-progress-ring";
import {
  restartMcqBankFolderPractice,
  restartMcqBankSubfolderPractice,
} from "@/lib/actions/mcq-bank-folder-practice";
import {
  normalizeFolderPracticeProgress,
  normalizeSubfolderPracticeProgress,
  type McqBankContainerPracticeProgress,
} from "@/lib/practice/mcq-bank-folder-progress";

/**
 * Shown when get_practice_batch returns no rows for a folder/subfolder.
 * Distinguishes empty container vs 100% complete (no silent re-round).
 */
export function FolderPracticeCompleteGate({
  folderId,
  folderName,
  backHref,
  containerKind = "folder",
}: {
  folderId: string;
  folderName: string;
  backHref: string;
  containerKind?: "folder" | "subfolder";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] =
    useState<McqBankContainerPracticeProgress | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const noun = containerKind === "subfolder" ? "subfolder" : "folder";
  const scopeType =
    containerKind === "subfolder" ? "mcq_bank_subfolder" : "mcq_bank_folder";

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      if (containerKind === "subfolder") {
        const { data, error } = await supabase.rpc(
          "get_mcq_bank_subfolder_practice_progress",
          { p_subfolder_id: folderId }
        );
        if (error) {
          setLoadError("Could not load subfolder progress.");
          return;
        }
        const p = normalizeSubfolderPracticeProgress(
          (data ?? {}) as Record<string, unknown>,
          folderId
        );
        setProgress({
          container_id: p.subfolder_id,
          total: p.total,
          done: p.done,
          remaining: p.remaining,
          percent_complete: p.percent_complete,
          complete: p.complete,
          favorites: p.favorites,
          incorrect: p.incorrect,
        });
        return;
      }
      const { data, error } = await supabase.rpc(
        "get_mcq_bank_folder_practice_progress",
        { p_folder_id: folderId }
      );
      if (error) {
        setLoadError("Could not load folder progress.");
        return;
      }
      const p = normalizeFolderPracticeProgress(
        (data ?? {}) as Record<string, unknown>,
        folderId
      );
      setProgress({
        container_id: p.folder_id,
        total: p.total,
        done: p.done,
        remaining: p.remaining,
        percent_complete: p.percent_complete,
        complete: p.complete,
        favorites: p.favorites,
        incorrect: p.incorrect,
      });
    })();
  }, [folderId, containerKind]);

  const sessionHref = `/practice/session?scope=${scopeType}&id=${encodeURIComponent(folderId)}&name=${encodeURIComponent(folderName)}`;

  function restartAndStart() {
    startTransition(async () => {
      const res =
        containerKind === "subfolder"
          ? await restartMcqBankSubfolderPractice(folderId)
          : await restartMcqBankFolderPractice(folderId);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Practice restarted");
      // Force a full navigation so the session remounts and loads a fresh batch.
      window.location.assign(sessionHref);
    });
  }

  if (loadError) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <p className="text-destructive">{loadError}</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={backHref}>Back</Link>
        </Button>
      </div>
    );
  }

  if (!progress) {
    return (
      <p className="text-sm text-muted-foreground">
        Checking {noun} progress…
      </p>
    );
  }

  if (progress.total <= 0) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <p className="text-muted-foreground">No questions available here yet.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={backHref}>Back to MCQ Bank</Link>
        </Button>
      </div>
    );
  }

  if (!progress.complete) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <p className="text-muted-foreground">
          No unfinished MCQs to serve right now. Return to the {noun} and try
          Start practice again.
        </p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={backHref}>Back to {noun}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <div className="flex items-center gap-4">
        <McqFolderProgressRing done={progress.done} total={progress.total} />
        <div>
          <h1 className="font-heading text-xl font-semibold text-[var(--student-ink)]">
            {containerKind === "subfolder"
              ? "Subfolder complete"
              : "Folder complete"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You finished all {progress.total} MCQs in {folderName}. Normal
            practice will not start another round until you restart.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={restartAndStart}
          data-testid={`mcq-${containerKind}-restart-practice-session`}
        >
          {pending ? "Restarting…" : "Restart Practice"}
        </Button>
        <Button asChild variant="outline">
          <Link href={backHref} onClick={() => router.refresh()}>
            Back to {noun}
          </Link>
        </Button>
      </div>
    </div>
  );
}
