"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createMcqBankFolder,
  renameMcqBankFolder,
  reorderMcqBankFolders,
  softDeleteMcqBankFolder,
} from "@/lib/actions/mcq-bank-folders";
import {
  ConfirmDangerDialog,
  purgeDateHint,
} from "@/components/admin/confirm-danger-dialog";
import {
  isMcqBankFolderEmptyForDelete,
  mcqBankFolderContentSummary,
  mcqBankFolderDeleteBlockedReason,
} from "@/lib/admin/mcq-bank-folder-ui";

export type McqBankFolderRow = {
  folder_id: string;
  name: string;
  sort_order: number;
  question_count: number;
  pdf_count: number;
  subfolder_count?: number;
};

export function McqBankFoldersAdmin({
  yearId,
  productKey,
  productSubjectId,
  subjectName,
  folders: initialFolders,
}: {
  yearId: string;
  productKey: string;
  productSubjectId: string;
  subjectName: string;
  folders: McqBankFolderRow[];
}) {
  const router = useRouter();
  const [folders, setFolders] = useState(initialFolders);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const sorted = useMemo(
    () =>
      [...folders].sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      ),
    [folders]
  );

  function refresh() {
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          {subjectName}
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Manage folders
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Folders hold subfolders (MCQs) and study PDFs for this product subject.
          Empty folders (no subfolders and no live PDFs) can be moved to the Bin.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link
            href={`/admin/mcq-bank?year=${yearId}`}
            className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
          >
            All product subjects
          </Link>
          <Link
            href={`/admin/mcq-bank/classify?year=${yearId}`}
            className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
          >
            Classify unassigned
          </Link>
        </div>
      </div>

      <form
        className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const { error, id } = await createMcqBankFolder(
              productSubjectId,
              name,
              productKey
            );
            if (error) {
              toast.error(error);
              return;
            }
            toast.success("Folder created");
            setName("");
            if (id) {
              setFolders((prev) => [
                ...prev,
                {
                  folder_id: id,
                  name: name.trim(),
                  sort_order: prev.length,
                  question_count: 0,
                  pdf_count: 0,
                  subfolder_count: 0,
                },
              ]);
            }
            refresh();
          });
        }}
      >
        <div className="grid min-w-0 flex-1 gap-1">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="folder-name"
          >
            New folder name
          </label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Block revision set"
            disabled={pending}
          />
        </div>
        <Button
          type="submit"
          disabled={pending || !name.trim()}
          className="w-full sm:w-auto"
        >
          Create folder
        </Button>
      </form>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No folders yet. Create one to place Academic MCQs.
        </p>
      ) : (
        <ul className="grid gap-3">
          {sorted.map((folder, index) => (
            <li
              key={folder.folder_id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  className="max-w-full font-medium sm:max-w-sm"
                  defaultValue={folder.name}
                  disabled={pending}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (!next || next === folder.name) return;
                    startTransition(async () => {
                      const { error } = await renameMcqBankFolder(
                        folder.folder_id,
                        next,
                        productKey
                      );
                      if (error) toast.error(error);
                      else {
                        setFolders((prev) =>
                          prev.map((f) =>
                            f.folder_id === folder.folder_id
                              ? { ...f, name: next }
                              : f
                          )
                        );
                        toast.success("Renamed");
                        refresh();
                      }
                    });
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {mcqBankFolderContentSummary(folder)}
                </p>
                {!isMcqBankFolderEmptyForDelete(folder) ? (
                  <p className="text-xs text-muted-foreground">
                    {mcqBankFolderDeleteBlockedReason(folder)}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild type="button" size="sm" variant="secondary">
                  <Link
                    href={`/admin/mcq-bank/${productKey}/${folder.folder_id}?year=${yearId}`}
                  >
                    Open
                  </Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || index === 0}
                  onClick={() =>
                    startTransition(async () => {
                      const ids = sorted.map((f) => f.folder_id);
                      const next = [...ids];
                      [next[index - 1], next[index]] = [
                        next[index]!,
                        next[index - 1]!,
                      ];
                      const { error } = await reorderMcqBankFolders(
                        productSubjectId,
                        next,
                        productKey
                      );
                      if (error) toast.error(error);
                      else {
                        toast.success("Reordered");
                        refresh();
                      }
                    })
                  }
                >
                  Move up
                </Button>
                <ConfirmDangerDialog
                  title="Delete empty folder?"
                  description={
                    <>
                      <p>
                        “{folder.name}” will be moved to the Bin if it has no
                        subfolders and no live PDFs. It stays until about{" "}
                        <strong>{purgeDateHint()}</strong>.
                      </p>
                      <p className="mt-2">
                        Folders with subfolders or PDFs cannot be deleted —
                        remove that content first.
                      </p>
                    </>
                  }
                  confirmLabel="Move to Bin"
                  disabled={!isMcqBankFolderEmptyForDelete(folder)}
                  trigger={
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={
                        pending || !isMcqBankFolderEmptyForDelete(folder)
                      }
                    >
                      Delete
                    </Button>
                  }
                  onConfirm={() =>
                    softDeleteMcqBankFolder(folder.folder_id, productKey)
                  }
                  onSuccess={() => {
                    setFolders((prev) =>
                      prev.filter((f) => f.folder_id !== folder.folder_id)
                    );
                    refresh();
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
