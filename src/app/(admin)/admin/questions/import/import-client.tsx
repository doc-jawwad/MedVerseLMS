"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createImportBatch,
  getImportReport,
  importChunk,
} from "@/lib/actions/import";
import {
  QUESTION_CSV_HEADERS,
  buildChatGptGenerationPrompt,
  buildQuestionCsvTemplateMatrix,
  flattenCsvErrors,
  formatCsvErrorsForCopy,
  parseQuestionCsvRecords,
  toImportPayloadRow,
  type CsvFieldError,
  type ParsedCsvRow,
} from "@/lib/questions/csv-import";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Batch = {
  id: string;
  filename: string;
  total_rows: number;
  inserted: number;
  skipped_duplicates: number;
  errors: number;
  created_at: string;
};

type Phase = "upload" | "preview" | "done";

export function ImportClient({
  subjects,
  recentBatches,
  mcqBankSubfolderId,
  folderLabel,
  lockedSubjectId,
  returnHref,
}: {
  subjects: { id: string; label: string }[];
  recentBatches: Batch[];
  /** When set, imported questions are placed in this Academic MCQ Bank subfolder. */
  mcqBankSubfolderId?: string;
  folderLabel?: string;
  /** Pre-select / lock departmental subject (CSV taxonomy under this subject). */
  lockedSubjectId?: string;
  returnHref?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [subjectId, setSubjectId] = useState(lockedSubjectId ?? "");
  const [status, setStatus] = useState("draft");
  const [createMissing, setCreateMissing] = useState(true);
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<ParsedCsvRow[]>([]);
  const [headerErrors, setHeaderErrors] = useState<CsvFieldError[]>([]);
  const [phase, setPhase] = useState<Phase>("upload");
  const [importing, setImporting] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [summary, setSummary] = useState<{
    inserted: number;
    skipped: number;
    errors: number;
    questionIds: string[];
    duplicateRows: number[];
  } | null>(null);

  const subjectLabel = subjects.find((s) => s.id === subjectId)?.label;
  const chatgptPrompt = useMemo(
    () => buildChatGptGenerationPrompt(subjectLabel),
    [subjectLabel]
  );

  const allErrors = useMemo(
    () => flattenCsvErrors(headerErrors, rows),
    [headerErrors, rows]
  );
  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);
  const canProceed =
    rows.length > 0 &&
    headerErrors.length === 0 &&
    invalidRows.length === 0 &&
    Boolean(subjectId);

  async function downloadTemplate() {
    const Papa = (await import("papaparse")).default;
    const csv = Papa.unparse(buildQuestionCsvTemplateMatrix());
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "medverse-question-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label}`);
    }
  }

  function resetParsed() {
    setRows([]);
    setHeaderErrors([]);
    setPhase("upload");
    setSummary(null);
    setPreviewIndex(0);
  }

  async function handleFile(file: File) {
    setFilename(file.name);
    setSummary(null);
    setPhase("upload");
    const lower = file.name.toLowerCase();

    let records: Record<string, string>[] = [];
    if (lower.endsWith(".csv")) {
      const Papa = (await import("papaparse")).default;
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      if (parsed.errors.length > 0) {
        const first = parsed.errors[0];
        toast.error(first?.message ?? "CSV parse failed");
      }
      records = parsed.data;
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      records = XLSX.utils
        .sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
        .map((r) =>
          Object.fromEntries(
            Object.entries(r).map(([k, v]) => [
              k.trim().toLowerCase(),
              String(v ?? ""),
            ])
          )
        );
    } else {
      toast.error("Please choose a .csv or .xlsx file");
      return;
    }

    const { rows: parsedRows, headerErrors: hdr } =
      parseQuestionCsvRecords(records);
    setHeaderErrors(hdr);
    setRows(parsedRows);
    setPreviewIndex(0);

    const errCount = flattenCsvErrors(hdr, parsedRows).length;
    if (errCount > 0) {
      toast.message(
        `Validated ${parsedRows.length} rows — ${errCount} error${errCount === 1 ? "" : "s"} to fix`
      );
    } else {
      toast.success(`Validated ${parsedRows.length} rows — ready to preview`);
    }
  }

  async function runImport() {
    if (!canProceed) {
      return void toast.error(
        allErrors.length > 0
          ? "Fix every CSV error before importing."
          : "Choose a subject and upload a valid CSV first."
      );
    }
    setImporting(true);
    setSummary(null);
    try {
      const batchRes = await createImportBatch(filename, rows.length);
      if ("error" in batchRes && batchRes.error) throw new Error(batchRes.error);
      const batchId = (batchRes as { id: string }).id;

      const payload = rows.map((r) =>
        toImportPayloadRow(r.raw, r.row_number, subjectId, status)
      );

      const res = await importChunk(
        batchId,
        payload,
        createMissing,
        mcqBankSubfolderId
      );
      if ("error" in res && res.error) throw new Error(res.error);
      if (!("result" in res) || !res.result) throw new Error("Import failed");

      const report = await getImportReport(batchId);
      const duplicateRows = report.rows
        .filter((r) => r.outcome === "skipped_duplicate")
        .map((r) => r.row_number as number);

      setSummary({
        inserted: res.result.inserted,
        skipped: res.result.skipped,
        errors: res.result.errors,
        questionIds: res.result.question_ids,
        duplicateRows,
      });
      setPhase("done");
      toast.success(
        `Import finished: ${res.result.inserted} added, ${res.result.skipped} duplicates skipped (not overwritten).`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const previewRow = validRows[previewIndex] ?? validRows[0];
  const previewOptions = previewRow
    ? (["a", "b", "c", "d", "e"] as const)
        .map((k) => ({
          key: k.toUpperCase(),
          text: (previewRow.raw[`option_${k}`] ?? "").trim(),
        }))
        .filter((o) => o.text)
    : [];
  const previewCorrect = (previewRow?.raw.correct ?? "").trim().toUpperCase();

  return (
    <div className="grid gap-6">
      {mcqBankSubfolderId ? (
        <div className="rounded-xl border bg-card px-4 py-3 text-sm">
          <p className="font-medium text-[var(--student-ink)]">
            Importing into MCQ Bank subfolder
            {folderLabel ? `: ${folderLabel}` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            New questions are placed in this subfolder automatically. Book /
            chapter / topic in the CSV remain Question Bank taxonomy metadata.
          </p>
          {returnHref ? (
            <Link
              href={returnHref}
              className="mt-2 inline-block text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
            >
              Back to folder
            </Link>
          ) : null}
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>1. Template &amp; ChatGPT prompt</CardTitle>
          <CardDescription>
            Canonical columns: {QUESTION_CSV_HEADERS.join(", ")}. Tags use{" "}
            <code>|</code>. Subject is chosen below (not a CSV column). Book /
            chapter / topic are matched by name under that subject.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              Download CSV template
            </Button>
            <Button
              variant="outline"
              onClick={() => void copyText("ChatGPT prompt", chatgptPrompt)}
            >
              Copy ChatGPT prompt
            </Button>
          </div>
          <div className="grid gap-2">
            <Label>ChatGPT generation prompt</Label>
            <Textarea
              readOnly
              value={chatgptPrompt}
              rows={12}
              className="font-mono text-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload &amp; validate</CardTitle>
          <CardDescription>
            Every row is validated before any database write. Fix errors, re-upload,
            and validate again. Import stays blocked until the file is clean.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Target subject</Label>
              <Select
                value={subjectId || undefined}
                onValueChange={setSubjectId}
                disabled={Boolean(lockedSubjectId)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lockedSubjectId ? (
                <p className="text-xs text-muted-foreground">
                  Locked for this folder import. Pick a departmental subject that
                  matches the CSV book/chapter/topic names.
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label>Import as</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <Checkbox
                checked={createMissing}
                onCheckedChange={(c) => setCreateMissing(c === true)}
              />
              Create missing books/chapters/topics
            </label>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />

          {rows.length > 0 && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge variant="default">{validRows.length} valid</Badge>
              {invalidRows.length > 0 || headerErrors.length > 0 ? (
                <Badge variant="destructive">
                  {allErrors.length} error{allErrors.length === 1 ? "" : "s"}
                </Badge>
              ) : (
                <Badge variant="secondary">No validation errors</Badge>
              )}
              <span className="text-muted-foreground">
                {filename} · {rows.length} data row
                {rows.length === 1 ? "" : "s"}
              </span>
            </div>
          )}

          {allErrors.length > 0 && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-destructive">
                  Validation errors — import blocked until fixed
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void copyText("All errors", formatCsvErrorsForCopy(allErrors))
                  }
                >
                  Copy all errors
                </Button>
                <Button size="sm" variant="ghost" onClick={resetParsed}>
                  Clear file
                </Button>
              </div>
              <div className="max-h-96 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Invalid value</TableHead>
                      <TableHead>Expected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allErrors.map((e, i) => (
                      <TableRow key={`${e.row}-${e.field}-${i}`}>
                        <TableCell>{e.row}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {e.field}
                        </TableCell>
                        <TableCell className="text-destructive">{e.error}</TableCell>
                        <TableCell className="max-w-[12rem] truncate font-mono text-xs">
                          {e.invalidValue ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {e.expected}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Textarea
                readOnly
                rows={8}
                className="font-mono text-xs"
                value={formatCsvErrorsForCopy(allErrors)}
              />
            </div>
          )}

          {rows.length > 0 && allErrors.length === 0 && phase === "upload" && (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  if (!subjectId) {
                    toast.error("Choose the target subject first.");
                    return;
                  }
                  setPhase("preview");
                  setPreviewIndex(0);
                }}
                disabled={!subjectId}
              >
                Preview as student ({validRows.length})
              </Button>
              <Button variant="ghost" onClick={resetParsed}>
                Clear file
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {phase === "preview" && previewRow && (
        <Card>
          <CardHeader>
            <CardTitle>3. Student preview &amp; confirm import</CardTitle>
            <CardDescription>
              Review questions as a student sees them (answers hidden by default).
              Duplicates matching an existing content hash are skipped — never
              overwritten. The import runs in one database transaction; a hard
              failure rolls back the whole batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={previewIndex <= 0}
                onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
              >
                Previous
              </Button>
              <span>
                Question {previewIndex + 1} of {validRows.length} (CSV row{" "}
                {previewRow.row_number})
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={previewIndex >= validRows.length - 1}
                onClick={() =>
                  setPreviewIndex((i) =>
                    Math.min(validRows.length - 1, i + 1)
                  )
                }
              >
                Next
              </Button>
              <label className="ml-auto flex items-center gap-2 text-muted-foreground">
                Show answer
                <Switch checked={showAnswer} onCheckedChange={setShowAnswer} />
              </label>
            </div>

            <div className="rounded-md border p-4">
              <p className="mb-1 text-xs text-muted-foreground">
                {previewRow.raw.book} → {previewRow.raw.chapter} →{" "}
                {previewRow.raw.topic}
                {previewRow.raw.difficulty
                  ? ` · ${previewRow.raw.difficulty}`
                  : ""}
              </p>
              <p className="whitespace-pre-wrap text-sm">
                {previewRow.raw.question}
              </p>
              <div className="mt-3 grid gap-2">
                {previewOptions.map((o) => (
                  <div
                    key={o.key}
                    className={`rounded-md border p-2 text-sm ${
                      showAnswer && o.key === previewCorrect
                        ? "border-green-600 bg-green-50 dark:bg-green-950"
                        : ""
                    }`}
                  >
                    <span className="mr-2 font-medium">{o.key}.</span>
                    {o.text}
                  </div>
                ))}
              </div>
              {showAnswer &&
                ((previewRow.raw.explanation ?? "").trim() ||
                  (previewRow.raw.reference ?? "").trim()) && (
                  <div className="mt-3 rounded-md bg-muted p-3 text-sm">
                    {(previewRow.raw.explanation ?? "").trim() && (
                      <p className="whitespace-pre-wrap">
                        {previewRow.raw.explanation}
                      </p>
                    )}
                    {(previewRow.raw.reference ?? "").trim() && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Reference: {previewRow.raw.reference}
                      </p>
                    )}
                  </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void runImport()} disabled={importing}>
                {importing
                  ? "Importing…"
                  : `Confirm import ${validRows.length} question${
                      validRows.length === 1 ? "" : "s"
                    } as ${status}`}
              </Button>
              <Button
                variant="outline"
                disabled={importing}
                onClick={() => setPhase("upload")}
              >
                Back to validation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {summary && phase === "done" && (
        <Card>
          <CardHeader>
            <CardTitle>4. Import result</CardTitle>
            <CardDescription>
              Edit any imported question before publishing to tests or practice.
              Status transitions stay on the normal draft → review → approved path
              unless you imported as approved.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm">
              <b>{summary.inserted}</b> added ·{" "}
              <b>{summary.skipped}</b> duplicates skipped (not overwritten)
              {summary.duplicateRows.length > 0 && (
                <> — CSV rows {summary.duplicateRows.join(", ")}</>
              )}
              {summary.errors > 0 && (
                <>
                  {" "}
                  · <b>{summary.errors}</b> errors
                </>
              )}
            </p>
            {summary.questionIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {summary.questionIds.slice(0, 20).map((id) => (
                  <Button key={id} asChild size="sm" variant="outline">
                    <Link href={`/admin/questions/${id}`}>
                      Edit {id.slice(0, 8)}…
                    </Link>
                  </Button>
                ))}
                {summary.questionIds.length > 20 && (
                  <span className="text-sm text-muted-foreground">
                    +{summary.questionIds.length - 20} more — open Question Bank
                    to filter by subject.
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/admin/questions">Open Question Bank</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  resetParsed();
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {recentBatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent imports</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Duplicates</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBatches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.filename}</TableCell>
                    <TableCell>{b.total_rows}</TableCell>
                    <TableCell>{b.inserted}</TableCell>
                    <TableCell>{b.skipped_duplicates}</TableCell>
                    <TableCell>{b.errors}</TableCell>
                    <TableCell>{formatDateTime(b.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
