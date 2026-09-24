"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  createImportBatch,
  importChunk,
  type ImportRow,
} from "@/lib/actions/import";
import { addQuestionsToTest } from "@/lib/actions/tests";
import {
  flattenCsvErrors,
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
 * Test Builder CSV import — reuses Question Bank parser + import_question_batch,
 * then attaches inserted IDs to this draft via add_questions_to_test.
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
  } | null>(null);

  function onFile(file: File | null) {
    if (!file) return;
    if (!subjectId) {
      toast.error("Select a subject for the CSV rows.");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const records = (result.data ?? []) as Record<string, string>[];
        const { rows, headerErrors } = parseQuestionCsvRecords(records);
        const allErrors = flattenCsvErrors(headerErrors, rows);
        setPreview({
          filename: file.name,
          rows,
          errorCount: allErrors.length,
        });
        if (allErrors.length > 0) {
          toast.error(
            `${allErrors.length} validation issue(s). Fix the CSV before importing.`
          );
        } else {
          toast.message(
            `${rows.length} valid row(s) ready. Click Import & add to test.`
          );
        }
      },
      error: () => toast.error("Could not parse that CSV file."),
    });
  }

  function importAndAttach() {
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
      const add = await addQuestionsToTest(testId, questionIds);
      if (add.error) {
        toast.error(
          `Imported ${questionIds.length} question(s) to the bank, but could not attach to this test: ${add.error}`
        );
        router.refresh();
        return;
      }
      toast.success(
        `Added ${questionIds.length} CSV question(s) to this test` +
          (skipped || errors
            ? ` (skipped ${skipped}, row errors ${errors})`
            : "")
      );
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
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
      className="grid gap-3 rounded-lg border border-dashed border-border/80 p-4"
      data-testid="test-builder-csv-import"
    >
      <div>
        <h3 className="text-sm font-semibold">Import questions from CSV</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Uses the same Question Bank CSV format and import pipeline. Rows are
          inserted as <strong>approved</strong> (like Manual MCQ), then attached
          to this draft. Publish still freezes question versions.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor="tb-csv-subject">Subject for CSV rows</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger id="tb-csv-subject">
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
        <div className="grid gap-1">
          <Label htmlFor="tb-csv-file">CSV file</Label>
          <input
            id="tb-csv-file"
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            disabled={pending}
          />
        </div>
      </div>
      {preview ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
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
            onClick={importAndAttach}
          >
            {pending ? "Importing…" : "Import & add to test"}
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
      ) : null}
      <p className="text-xs text-muted-foreground">
        Prefer the full Question Bank importer for large files or drafts needing
        review — then add from the pool below.
      </p>
    </div>
  );
}
