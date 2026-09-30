"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { McqFolderProgressRing } from "@/components/library/mcq-folder-progress-ring";
import { restartMcqBankFolderPractice } from "@/lib/actions/mcq-bank-folder-practice";
import {
  normalizeFolderPracticeProgress,
  type McqBankFolderPracticeProgress,
} from "@/lib/practice/mcq-bank-folder-progress";

/**
 * Shown when get_practice_batch returns no rows for a folder.
 * Distinguishes empty folder vs 100% complete (no silent re-round).
 */
export function FolderPracticeCompleteGate({
  folderId,
  folderName,
  backHref,
}: {
  folderId: string;
  folderName: string;
  backHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<McqBankFolderPracticeProgress | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data, error } = await supabase.rpc(
        "get_mcq_bank_folder_practice_progress",
        { p_folder_id: folderId }
      );
      if (error) {
        setLoadError("Could not load folder progress.");
        return;
      }
      setProgress(
        normalizeFolderPracticeProgress(
          (data ?? {}) as Record<string, unknown>,
          folderId
        )
      );
    })();
  }, [folderId]);

  const sessionHref = `/practice/session?scope=mcq_bank_folder&id=${encodeURIComponent(folderId)}&name=${encodeURIComponent(folderName)}`;

  function restartAndStart() {
    startTransition(async () => {
      const res = await restartMcqBankFolderPractice(folderId);
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
      <p className="text-sm text-muted-foreground">Checking folder progress…</p>
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
          No unfinished MCQs to serve right now. Return to the folder and try
          Start practice again.
        </p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={backHref}>Back to folder</Link>
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
            Folder complete
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
          data-testid="mcq-folder-restart-practice-session"
        >
          {pending ? "Restarting…" : "Restart Practice"}
        </Button>
        <Button asChild variant="outline">
          <Link href={backHref} onClick={() => router.refresh()}>
            Back to folder
          </Link>
        </Button>
      </div>
    </div>
  );
}
