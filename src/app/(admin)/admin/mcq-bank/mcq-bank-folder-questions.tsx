"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  filterMcqMoveDestinations,
  mcqMoveDestinationLabel,
  type McqMoveDestination,
} from "@/lib/admin/mcq-bank-move";
import {
  bulkMoveMcqBankFolderQuestions,
  bulkSoftDeleteFolderQuestions,
  removeQuestionFromMcqBankFolder,
} from "@/lib/actions/mcq-bank-folders";

export type FolderQuestionRow = {
  question_id: string;
  status: string;
  difficulty: string | null;
  stem: string | null;
  subject_name: string | null;
  topic_name: string | null;
};

const MOVE_DELETE_MAX = 2000;

/**
 * Folder-scope MCQ list + Move (product-scoped destinations).
 * Mounted on the live folder page under subfolder/PDF admin.
 * Bulk "Remove from folder" is omitted — folder remove RPC is a subfolder-era stub.
 */
export function McqBankFolderQuestions({
  yearId,
  productKey,
  folderId,
  questions,
  moveDestinations,
  totalCount,
  page,
  pageSize,
}: {
  yearId: string;
  productKey: string;
  folderId: string;
  questions: FolderQuestionRow[];
  moveDestinations: McqMoveDestination[];
  totalCount: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllInFolder, setSelectAllInFolder] = useState(false);
  const [destSubfolderId, setDestSubfolderId] = useState("");

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageIds = useMemo(
    () => questions.map((q) => q.question_id),
    [questions]
  );
  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = selectAllInFolder ? totalCount : selected.size;
  const destinations = filterMcqMoveDestinations(moveDestinations);
  const destMeta = destinations.find((d) => d.subfolder_id === destSubfolderId);

  function clearSelection() {
    setSelected(new Set());
    setSelectAllInFolder(false);
  }

  function togglePageAll() {
    if (selectAllInFolder) {
      clearSelection();
      return;
    }
    if (pageAllSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(pageIds));
  }

  function toggleOne(id: string) {
    if (selectAllInFolder) {
      setSelectAllInFolder(false);
      setSelected(new Set(pageIds.filter((x) => x !== id)));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectionPayload():
    | { questionIds: string[]; allInFolder?: undefined }
    | { allInFolder: true; questionIds?: undefined }
    | null {
    if (selectAllInFolder) {
      if (totalCount <= 0) return null;
      if (totalCount > MOVE_DELETE_MAX) {
        toast.error(
          `Too many questions (${totalCount}). Max ${MOVE_DELETE_MAX} per operation.`
        );
        return null;
      }
      return { allInFolder: true };
    }
    const ids = Array.from(selected);
    if (ids.length === 0) return null;
    if (ids.length > MOVE_DELETE_MAX) {
      toast.error(
        `Too many questions (${ids.length}). Max ${MOVE_DELETE_MAX} per operation.`
      );
      return null;
    }
    return { questionIds: ids };
  }

  function runBulkMove() {
    const payload = selectionPayload();
    if (!payload) {
      toast.error("Select questions first.");
      return;
    }
    if (!destSubfolderId || !destMeta) {
      toast.error("Choose a destination subfolder.");
      return;
    }
    if (
      !window.confirm(
        `Move ${selectedCount} question(s) to “${mcqMoveDestinationLabel(destMeta)}”? Question IDs stay the same.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await bulkMoveMcqBankFolderQuestions({
        sourceFolderId: folderId,
        destSubfolderId,
        destFolderId: destMeta.folder_id,
        productKey,
        ...(payload.allInFolder
          ? { allInSource: true }
          : { questionIds: payload.questionIds }),
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const moved =
        "result" in res && res.result ? res.result.moved : selectedCount;
      toast.success(`Moved ${moved} question(s)`);
      clearSelection();
      setDestSubfolderId("");
      router.refresh();
    });
  }

  function runBulkBin() {
    const payload = selectionPayload();
    if (!payload) {
      toast.error("Select questions first.");
      return;
    }
    if (
      !window.confirm(
        `Move ${selectedCount} question(s) to the Bin?\n\nThis soft-deletes the MCQs (recoverable ~7 days). It is not “remove from folder” only.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await bulkSoftDeleteFolderQuestions({
        folderId,
        productKey,
        ...(payload.allInFolder
          ? { allInFolder: true }
          : { questionIds: payload.questionIds }),
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const r = "result" in res ? res.result : undefined;
      const parts: string[] = [];
      if (r && r.binned > 0) parts.push(`${r.binned} moved to Bin`);
      if (r && r.blocked_active_test > 0)
        parts.push(`${r.blocked_active_test} blocked (active test)`);
      if (r && r.not_found > 0) parts.push(`${r.not_found} not in folder`);
      toast.success(parts.join(" · ") || "Done");
      clearSelection();
      router.refresh();
    });
  }

  const basePath = `/admin/mcq-bank/${productKey}/${folderId}`;

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">MCQs in this folder</h2>
        <p className="text-sm text-muted-foreground">
          {totalCount} question{totalCount === 1 ? "" : "s"} across all
          subfolders. Move to any live subfolder in this product.
        </p>
      </div>

      {questions.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No questions in this folder yet. Open a subfolder to import or add an
          MCQ.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={selectAllInFolder || pageAllSelected}
                  onCheckedChange={togglePageAll}
                  disabled={pending}
                  aria-label="Select all on this page"
                />
                <span>Select page ({pageIds.length})</span>
              </label>
              {totalCount > pageIds.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant={selectAllInFolder ? "secondary" : "outline"}
                  disabled={pending || totalCount > MOVE_DELETE_MAX}
                  onClick={() => {
                    setSelectAllInFolder(true);
                    setSelected(new Set());
                  }}
                >
                  Select all in folder ({totalCount})
                </Button>
              ) : null}
              {selectedCount > 0 ? (
                <span className="font-medium">{selectedCount} selected</span>
              ) : null}
              {selectedCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={clearSelection}
                >
                  Clear
                </Button>
              ) : null}
            </div>

            {selectedCount > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="grid min-w-0 flex-1 gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="mcq-folder-move-dest"
                  >
                    Move to subfolder
                  </label>
                  <select
                    id="mcq-folder-move-dest"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={destSubfolderId}
                    disabled={pending || destinations.length === 0}
                    onChange={(e) => setDestSubfolderId(e.target.value)}
                  >
                    <option value="">
                      {destinations.length === 0
                        ? "No destination subfolders in this product"
                        : "Choose destination…"}
                    </option>
                    {destinations.map((f) => (
                      <option key={f.subfolder_id} value={f.subfolder_id}>
                        {mcqMoveDestinationLabel(f)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || !destSubfolderId}
                  onClick={runBulkMove}
                >
                  {pending ? "Moving…" : "Move"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={runBulkBin}
                >
                  Move to Bin
                </Button>
              </div>
            ) : null}
          </div>

          <ul className="grid gap-3">
            {questions.map((q) => {
              const checked =
                selectAllInFolder || selected.has(q.question_id);
              return (
                <li
                  key={q.question_id}
                  className={`flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between ${
                    checked ? "border-primary/40 bg-muted/20" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleOne(q.question_id)}
                      disabled={pending}
                      aria-label="Select question"
                      className="mt-1"
                    />
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/admin/questions/${q.question_id}`}
                        className="line-clamp-3 text-sm font-medium hover:underline"
                      >
                        {q.stem || "(no stem)"}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          {q.status.replace("_", " ")}
                        </Badge>
                        {q.difficulty ? <span>{q.difficulty}</span> : null}
                        {q.subject_name ? <span>{q.subject_name}</span> : null}
                        {q.topic_name ? <span>· {q.topic_name}</span> : null}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full shrink-0 sm:w-auto"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Remove this question from the MCQ Bank placement? It stays in the Question Bank as unassigned."
                        )
                      ) {
                        return;
                      }
                      startTransition(async () => {
                        const { error } = await removeQuestionFromMcqBankFolder(
                          q.question_id,
                          productKey
                        );
                        if (error) toast.error(error);
                        else {
                          toast.success("Removed from folder");
                          router.refresh();
                        }
                      });
                    }}
                  >
                    Remove from folder
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline" disabled={page <= 0}>
              <Link
                href={`${basePath}?year=${yearId}&page=${Math.max(0, page - 1)}`}
                aria-disabled={page <= 0}
              >
                Previous
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="outline"
              disabled={page + 1 >= totalPages}
            >
              <Link
                href={`${basePath}?year=${yearId}&page=${page + 1}`}
                aria-disabled={page + 1 >= totalPages}
              >
                Next
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
