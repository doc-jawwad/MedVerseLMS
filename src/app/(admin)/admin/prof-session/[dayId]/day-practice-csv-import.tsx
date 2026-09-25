"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createImportBatch,
  importChunk,
  type ImportRow,
} from "@/lib/actions/import";
import { setDayPracticeQuestions } from "@/lib/actions/prof-session";
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
 * Prof. Session Day Practice MCQ CSV import.
 * Reuses Question Bank parser + import_question_batch, then merges inserted
 * IDs into this day's practice set (day-scoped junction only).
 */
export function DayPracticeCsvImport({
  dayId,
  linkedPracticeIds,
  subjects,
  onAttached,
}: {
  dayId: string;
  linkedPracticeIds: string[];
  subjects: { id: string; name: string }[];
  onAttached?: (ids: string[]) => void;
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
        const errorLines = formatCsvErrorsForCopy(allErrors)
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
            `${rows.length} valid row(s) ready. Click Import & add to day.`
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
        `ps-day:${dayId}:${preview.filename}`,
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
          `No questions to attach (inserted=${inserted}, skipped=${skipped}, errors=${errors}).`
        );
        return;
      }
      const merged = Array.from(
        new Set([...linkedPracticeIds, ...questionIds])
      );
      const attach = await setDayPracticeQuestions(dayId, merged);
      if (attach.error) {
        toast.error(
          `Resolved ${questionIds.length} question(s) in the bank, but could not attach to this day: ${attach.error}`
        );
        router.refresh();
        return;
      }
      toast.success(
        `Added ${questionIds.length} CSV question(s) to this day` +
          (inserted || skipped
            ? ` (new ${inserted}, already in bank ${skipped}` +
              (errors ? `, row errors ${errors}` : "") +
              ")"
            : "")
      );
      onAttached?.(merged);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  if (subjects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No subjects for this class — CSV import needs a subject for year
        scoping.
      </p>
    );
  }

  return (
    <div
      className="grid gap-3 rounded-lg border border-dashed border-border/80 p-4"
      data-testid="day-practice-csv-import"
    >
      <div>
        <h3 className="text-sm font-semibold">CSV Import</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Same Question Bank CSV format and import pipeline. Rows insert as{" "}
          <strong>approved</strong>, then attach to <strong>this day only</strong>.
          Other days are unchanged.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor="day-csv-subject">Subject for CSV rows</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger id="day-csv-subject">
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
          <Label htmlFor="day-csv-file">CSV file</Label>
          <input
            id="day-csv-file"
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            data-testid="day-practice-csv-file"
            className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            disabled={pending}
          />
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
              data-testid="day-practice-csv-commit"
              onClick={importAndAttach}
            >
              {pending ? "Importing…" : "Import & add to day"}
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
              data-testid="day-practice-csv-errors"
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
    </div>
  );
}
