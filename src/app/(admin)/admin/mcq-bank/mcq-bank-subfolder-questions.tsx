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
  bulkMoveMcqBankSubfolderQuestions,
  bulkRemoveQuestionsFromMcqBankSubfolder,
  bulkSoftDeleteSubfolderQuestions,
  removeQuestionFromMcqBankSubfolder,
} from "@/lib/actions/mcq-bank-subfolders";

export type SubfolderQuestionRow = {
  question_id: string;
  status: string;
  difficulty: string | null;
  stem: string | null;
  subject_name: string | null;
  topic_name: string | null;
};

/** @deprecated Use McqMoveDestination — kept for older imports. */
export type SiblingSubfolderOption = McqMoveDestination;

const MOVE_DELETE_MAX = 2000;

export function McqBankSubfolderQuestions({
  yearId,
  productKey,
  folderId,
  folderName,
  subfolderId,
  subfolderName,
  subjectName,
  questions,
  siblingSubfolders,
  moveDestinations,
  totalCount,
  page,
  pageSize,
}: {
  yearId: string;
  productKey: string;
  folderId: string;
  folderName: string;
  subfolderId: string;
  subfolderName: string;
  subjectName: string;
  questions: SubfolderQuestionRow[];
  /** @deprecated Prefer moveDestinations (product-scoped). */
  siblingSubfolders?: McqMoveDestination[];
  moveDestinations?: McqMoveDestination[];
  totalCount: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllInSubfolder, setSelectAllInSubfolder] = useState(false);
  const [destSubfolderId, setDestSubfolderId] = useState("");

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const importHref = `/admin/questions/import?subfolderId=${encodeURIComponent(subfolderId)}&year=${yearId}`;
  const pageIds = useMemo(
    () => questions.map((q) => q.question_id),
    [questions]
  );
  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = selectAllInSubfolder ? totalCount : selected.size;
  const destinations = filterMcqMoveDestinations(
    moveDestinations ?? siblingSubfolders ?? [],
    { excludeSubfolderId: subfolderId }
  );
  const destMeta = destinations.find((d) => d.subfolder_id === destSubfolderId);

  function clearSelection() {
    setSelected(new Set());
    setSelectAllInSubfolder(false);
  }

  function togglePageAll() {
    if (selectAllInSubfolder) {
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
    if (selectAllInSubfolder) {
      setSelectAllInSubfolder(false);
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
    | { questionIds: string[]; allInSubfolder?: undefined }
    | { allInSubfolder: true; questionIds?: undefined }
    | null {
    if (selectAllInSubfolder) {
      if (totalCount <= 0) return null;
      if (totalCount > MOVE_DELETE_MAX) {
        toast.error(
          `Too many questions (${totalCount}). Max ${MOVE_DELETE_MAX} per operation.`
        );
        return null;
      }
      return { allInSubfolder: true };
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
      const res = await bulkMoveMcqBankSubfolderQuestions({
        sourceSubfolderId: subfolderId,
        destSubfolderId,
        productKey,
        folderId,
        destFolderId: destMeta.folder_id,
        ...(payload.allInSubfolder
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

  function runBulkRemove() {
    const payload = selectionPayload();
    if (!payload) {
      toast.error("Select questions first.");
      return;
    }
    if (
      !window.confirm(
        `Remove ${selectedCount} question(s) from this subfolder?\n\nThey stay in the Question Bank as unassigned (not deleted).`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await bulkRemoveQuestionsFromMcqBankSubfolder({
        subfolderId,
        productKey,
        folderId,
        ...(payload.allInSubfolder
          ? { allInSubfolder: true }
          : { questionIds: payload.questionIds }),
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const removed =
        "result" in res && res.result ? res.result.removed : selectedCount;
      toast.success(`Removed ${removed} from subfolder`);
      clearSelection();
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
        `Move ${selectedCount} question(s) to the Bin?\n\nThis soft-deletes the MCQs (recoverable ~7 days). It is not “remove from subfolder” only.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await bulkSoftDeleteSubfolderQuestions({
        subfolderId,
        productKey,
        folderId,
        ...(payload.allInSubfolder
          ? { allInSubfolder: true }
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
      if (r && r.not_found > 0) parts.push(`${r.not_found} not in subfolder`);
      toast.success(parts.join(" · ") || "Done");
      clearSelection();
      router.refresh();
    });
  }

  const basePath = `/admin/mcq-bank/${productKey}/${folderId}/${subfolderId}`;

  return (
    <div className="grid gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            {subjectName}
          </p>
          <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
            {subfolderName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Subfolder of {folderName}. Taxonomy metadata stays on each question
            for authoring/search.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/admin/mcq-bank/${productKey}/${folderId}?year=${yearId}`}
              className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
            >
              Back to {folderName}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="w-fit shrink-0">
            <Link href={importHref}>Import CSV</Link>
          </Button>
          <Button asChild size="sm" className="w-fit shrink-0">
            <Link
              href={`/admin/questions/new?subfolderId=${subfolderId}&year=${yearId}`}
            >
              Add MCQ
            </Link>
          </Button>
        </div>
      </div>

      <section className="grid gap-4">
        <div>
          <h2 className="text-lg font-semibold">MCQs</h2>
          <p className="text-sm text-muted-foreground">
            {totalCount} question{totalCount === 1 ? "" : "s"} in this subfolder
          </p>
        </div>

        {questions.length === 0 ? (
          <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No questions in this subfolder yet. Import a CSV or add an MCQ.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={selectAllInSubfolder || pageAllSelected}
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
                    variant={selectAllInSubfolder ? "secondary" : "outline"}
                    disabled={pending || totalCount > MOVE_DELETE_MAX}
                    onClick={() => {
                      setSelectAllInSubfolder(true);
                      setSelected(new Set());
                    }}
                  >
                    Select all in subfolder ({totalCount})
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
                      htmlFor="mcq-move-dest-subfolder"
                    >
                      Move to subfolder
                    </label>
                    <select
                      id="mcq-move-dest-subfolder"
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={destSubfolderId}
                      disabled={pending || destinations.length === 0}
                      onChange={(e) => setDestSubfolderId(e.target.value)}
                    >
                      <option value="">
                        {destinations.length === 0
                          ? "No other destination subfolders in this product"
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
                    variant="outline"
                    disabled={pending}
                    onClick={runBulkRemove}
                  >
                    Remove from subfolder
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
                  selectAllInSubfolder || selected.has(q.question_id);
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
                          {q.subject_name ? (
                            <span>{q.subject_name}</span>
                          ) : null}
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
                            "Remove this question from the subfolder? It stays in the Question Bank as unassigned."
                          )
                        ) {
                          return;
                        }
                        startTransition(async () => {
                          const { error } =
                            await removeQuestionFromMcqBankSubfolder(
                              q.question_id,
                              productKey,
                              folderId
                            );
                          if (error) toast.error(error);
                          else {
                            toast.success("Removed from subfolder");
                            router.refresh();
                          }
                        });
                      }}
                    >
                      Remove from subfolder
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
    </div>
  );
}
