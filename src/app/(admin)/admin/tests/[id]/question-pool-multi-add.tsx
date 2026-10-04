"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addQuestionsToTest } from "@/lib/actions/tests";
import {
  importedSetSelectableIds,
  mergeSelectionWithImportedSet,
  partitionImportedAdd,
  type ImportedQuestionSet,
} from "@/lib/tests/import-batch-selection";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type PoolItem = {
  id: string;
  difficulty: string;
  stem: string | null;
  subject: string | null;
};

export function QuestionPoolMultiAdd({
  testId,
  pool,
  importedSet,
  alreadyOnTestIds = [],
}: {
  testId: string;
  pool: PoolItem[];
  importedSet?: ImportedQuestionSet | null;
  /** Question IDs already attached to this draft (for idempotent batch add). */
  alreadyOnTestIds?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const poolIds = useMemo(() => pool.map((p) => p.id), [pool]);
  const importedSelectable = useMemo(
    () =>
      importedSet
        ? importedSetSelectableIds({
            importedIds: importedSet.questionIds,
            alreadyOnTest: alreadyOnTestIds,
          })
        : [],
    [importedSet, alreadyOnTestIds]
  );
  const importedOnPool = useMemo(
    () =>
      importedSet
        ? importedSetSelectableIds({
            importedIds: importedSet.questionIds,
            alreadyOnTest: alreadyOnTestIds,
            poolIds,
          })
        : [],
    [importedSet, alreadyOnTestIds, poolIds]
  );

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectImportedSet() {
    if (!importedSet || importedOnPool.length === 0) return;
    setSelected(
      (prev) =>
        new Set(mergeSelectionWithImportedSet(prev, importedOnPool))
    );
    toast.message(
      `Selected ${importedOnPool.length} question(s) from imported set`
    );
  }

  function selectAllOnPage() {
    if (pool.length === 0) return;
    setSelected((prev) => new Set(mergeSelectionWithImportedSet(prev, poolIds)));
  }

  function addSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await addQuestionsToTest(testId, ids);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.added !== undefined ? `Added (${res.added})` : "Added"
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  function addImportedSet() {
    if (!importedSet || importedSelectable.length === 0) return;
    const { toAdd } = partitionImportedAdd({
      importedIds: importedSet.questionIds,
      alreadyOnTest: alreadyOnTestIds,
    });
    if (toAdd.length === 0) {
      toast.message("All imported questions are already on this test.");
      return;
    }
    startTransition(async () => {
      const res = await addQuestionsToTest(testId, toAdd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.added !== undefined
          ? `Added imported set (${res.added})`
          : "Added imported set"
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="grid min-w-0 max-w-full gap-2">
      {importedSet ? (
        <div
          className="grid min-w-0 gap-2 rounded-md border border-dashed border-border/80 bg-muted/20 p-3"
          data-testid="imported-question-set"
          data-batch-id={importedSet.batchId}
        >
          <div className="min-w-0 break-words text-sm">
            <span className="font-medium">Imported set</span>
            <span className="text-muted-foreground">
              {" "}
              · {importedSet.questionIds.length} question
              {importedSet.questionIds.length === 1 ? "" : "s"}
              {importedSet.filename
                ? ` · ${importedSet.filename.replace(/^test-builder:/, "")}`
                : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {importedSelectable.length > 0
              ? `${importedSelectable.length} not yet on this test — select the set or add it in one step.`
              : "All questions from this import are already on this test."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || importedOnPool.length === 0}
              data-testid="select-imported-set"
              onClick={selectImportedSet}
            >
              Select imported set
              {importedOnPool.length > 0 ? ` (${importedOnPool.length})` : ""}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || importedSelectable.length === 0}
              data-testid="add-imported-set"
              onClick={addImportedSet}
            >
              Add imported set
              {importedSelectable.length > 0
                ? ` (${importedSelectable.length})`
                : ""}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} selected`
            : "Tick questions to add"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || pool.length === 0}
            data-testid="select-all-pool-page"
            onClick={selectAllOnPage}
          >
            Select page
          </Button>
          <Button
            size="sm"
            disabled={pending || selected.size === 0}
            data-testid="add-selected-questions"
            onClick={addSelected}
          >
            Add selected
          </Button>
        </div>
      </div>
      <div className="grid gap-1">
        {pool.map((p) => {
          const fromImport = Boolean(
            importedSet?.questionIds.includes(p.id)
          );
          return (
            <label
              key={p.id}
              className={`flex min-w-0 items-start gap-3 rounded-md border p-2 text-sm sm:items-center ${
                fromImport ? "border-primary/40 bg-primary/5" : ""
              }`}
              data-from-import={fromImport ? "true" : undefined}
            >
              <Checkbox
                checked={selected.has(p.id)}
                disabled={pending}
                data-testid={`tick-question-${p.id}`}
                onCheckedChange={(c) => toggle(p.id, c === true)}
                className="mt-0.5 shrink-0 sm:mt-0"
              />
              <div className="min-w-0 flex-1 break-words">
                {p.stem}
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.subject} · {p.difficulty}
                  {fromImport ? " · imported" : ""}
                </span>
              </div>
            </label>
          );
        })}
        {pool.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No more approved questions match this filter.
          </p>
        )}
      </div>
    </div>
  );
}
