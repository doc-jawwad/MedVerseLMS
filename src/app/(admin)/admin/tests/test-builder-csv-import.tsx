"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createImportBatch,
  importChunk,
  type ImportRow,
} from "@/lib/actions/import";
import {
  flattenCsvErrors,
  formatCsvErrorsForCopy,
  parseQuestionCsvRecords,
  toImportPayloadRow,
  type ParsedCsvRow,
} from "@/lib/questions/csv-import";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Test Builder CSV import — reuses Question Bank parser + import_question_batch.
 * Imported rows stay associated via import_batches / import_rows; the draft's
 * question picker then surfaces them as a selectable set (Add imported set).
 * Status is forced to approved so questions are eligible for the test pool
 * (same as createManualTestQuestion). Does not bypass freeze/publish rules.
 */
export function TestBuilderCsvImport({
  testId,
  subjects,
}: {
  testId: string;
  subjects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{
    filename: string;
    rows: ParsedCsvRow[];
    errorCount: number;
    errors: string[];
  } | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    if (!subjectId) {
      toast.error("Select a subject for the CSV rows.");
      return;
    }
    const Papa = (await import("papaparse")).default;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const records = (result.data ?? []) as Record<string, string>[];
        const { rows, headerErrors } = parseQuestionCsvRecords(records);
        const allErrors = flattenCsvErrors(headerErrors, rows);
        const errorLines =
          allErrors.length === 0
            ? []
            : formatCsvErrorsForCopy(allErrors)
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
        setPreview({
          filename: file.name,
          rows,
          errorCount: allErrors.length,
          errors: errorLines.slice(0, 12),
        });
        if (allErrors.length > 0) {
          toast.error(
            `${allErrors.length} validation issue(s). Fix the CSV before importing.`
          );
        } else {
          toast.message(
            `${rows.length} valid row(s) ready. Click Import CSV set.`
          );
        }
      },
      error: () => toast.error("Could not parse that CSV file."),
    });
  }

  function importCsvSet() {
    if (!preview || preview.rows.length === 0) return;
    if (preview.errorCount > 0) {
      toast.error("Resolve CSV validation errors before importing.");
      return;
    }
    if (!subjectId) {
      toast.error("Select a subject for the CSV rows.");
      return;
    }
    startTransition(async () => {
      const batch = await createImportBatch(
        `test-builder:${preview.filename}`,
        preview.rows.length
      );
      if ("error" in batch && batch.error) {
        toast.error(String(batch.error));
        return;
      }
      const batchId = (batch as { id: string }).id;
      const payload: ImportRow[] = preview.rows.map((r) =>
        toImportPayloadRow(r.raw, r.row_number, subjectId, "approved")
      );
      const CHUNK = 40;
      const questionIds: string[] = [];
      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const slice = payload.slice(i, i + CHUNK);
        const res = await importChunk(batchId, slice, true);
        if ("error" in res && res.error) {
          toast.error(String(res.error));
          return;
        }
        const r = (
          res as {
            result: {
              inserted: number;
              skipped: number;
              errors: number;
              question_ids: string[];
            };
          }
        ).result;
        inserted += r.inserted;
        skipped += r.skipped;
        errors += r.errors;
        questionIds.push(...r.question_ids);
      }
      if (questionIds.length === 0) {
        toast.error(
          `No questions inserted (inserted=${inserted}, skipped=${skipped}, errors=${errors}).`
        );
        return;
      }
      toast.success(
        `Imported ${questionIds.length} question(s) as a selectable set` +
          (skipped || errors
            ? ` (skipped ${skipped}, row errors ${errors})`
            : "") +
          ". Use Add imported set below."
      );
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      // Surface the batch in the question picker (import_rows identity).
      router.push(`/admin/tests/${testId}?import_batch=${batchId}`);
      router.refresh();
    });
  }

  if (subjects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No subjects for this test year — CSV import needs a subject.
      </p>
    );
  }

  return (
    <div
      className="grid min-w-0 max-w-full gap-3 rounded-lg border border-dashed border-border/80 p-4"
      data-testid="test-builder-csv-import"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Import questions from CSV</h3>
        <p className="mt-1 text-xs text-muted-foreground break-words">
          Uses the same Question Bank CSV format and import pipeline. Rows are
          inserted as <strong>approved</strong> (like Manual MCQ), then shown
          below as a selectable imported set. Publish still freezes question
          versions.
        </p>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 sm:items-end">
        <div className="grid min-w-0 gap-1">
          <Label htmlFor="tb-csv-subject">Subject for CSV rows</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger id="tb-csv-subject" className="max-w-full min-w-0">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor="tb-csv-file">CSV file</Label>
          {/* Native file inputs have a large intrinsic min-width that forces
              the Add-questions Card past the mobile viewport. Keep the real
              input for Playwright/setInputFiles, trigger it from a button. */}
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <input
              id="tb-csv-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              data-testid="test-builder-csv-file"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              disabled={pending}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              data-testid="test-builder-csv-choose"
              onClick={() => fileRef.current?.click()}
            >
              Choose CSV
            </Button>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {preview?.filename ?? "No file chosen"}
            </span>
          </div>
        </div>
      </div>
      {preview ? (
        <div className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {preview.filename}: {preview.rows.length} row(s)
              {preview.errorCount > 0
                ? ` · ${preview.errorCount} validation error(s)`
                : " · valid"}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={pending || preview.errorCount > 0}
              data-testid="test-builder-csv-commit"
              onClick={importCsvSet}
            >
              {pending ? "Importing…" : "Import CSV set"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setPreview(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Clear
            </Button>
          </div>
          {preview.errors.length > 0 ? (
            <ul
              className="max-h-40 list-disc overflow-y-auto rounded-md border bg-muted/30 px-5 py-2 text-xs text-destructive"
              data-testid="test-builder-csv-errors"
            >
              {preview.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
              {preview.errorCount > preview.errors.length ? (
                <li>
                  …and {preview.errorCount - preview.errors.length} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Prefer the full Question Bank importer for large files — then filter
        the pool below, or re-import here to get an imported set handle.
      </p>
    </div>
  );
}
