"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  createImportBatch,
  importChunk,
  type ImportRow,
} from "@/lib/actions/import";
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

const TEMPLATE_HEADERS = [
  "question",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "correct",
  "explanation",
  "reference",
  "book",
  "chapter",
  "topic",
  "difficulty",
  "tags",
];

type ParsedRow = {
  row_number: number;
  raw: Record<string, string>;
  errors: string[];
};

type Batch = {
  id: string;
  filename: string;
  total_rows: number;
  inserted: number;
  skipped_duplicates: number;
  errors: number;
  created_at: string;
};

function validateRow(raw: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!raw.question?.trim()) errors.push("question missing");
  for (const k of ["option_a", "option_b", "option_c", "option_d"]) {
    if (!raw[k]?.trim()) errors.push(`${k} missing`);
  }
  const correct = raw.correct?.trim().toUpperCase();
  if (!correct || !["A", "B", "C", "D", "E"].includes(correct)) {
    errors.push("correct must be A–E");
  } else if (correct === "E" && !raw.option_e?.trim()) {
    errors.push("correct is E but option_e is empty");
  }
  for (const k of ["book", "chapter", "topic"]) {
    if (!raw[k]?.trim()) errors.push(`${k} missing`);
  }
  const diff = raw.difficulty?.trim().toLowerCase();
  if (diff && !["easy", "medium", "hard"].includes(diff)) {
    errors.push("difficulty must be easy/medium/hard");
  }
  return errors;
}

function toImportRow(r: ParsedRow, subjectId: string, status: string): ImportRow {
  const raw = r.raw;
  const options = (["a", "b", "c", "d", "e"] as const)
    .map((k) => ({ key: k.toUpperCase(), text: (raw[`option_${k}`] ?? "").trim() }))
    .filter((o) => o.text !== "");
  return {
    row_number: r.row_number,
    subject_id: subjectId,
    book: (raw.book ?? "").trim(),
    chapter: (raw.chapter ?? "").trim(),
    topic: (raw.topic ?? "").trim(),
    stem: (raw.question ?? "").trim(),
    options,
    correct_key: (raw.correct ?? "").trim().toUpperCase(),
    explanation: (raw.explanation ?? "").trim(),
    reference: (raw.reference ?? "").trim(),
    difficulty: (raw.difficulty ?? "medium").trim().toLowerCase() || "medium",
    tags: (raw.tags ?? "")
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean),
    status,
    ...(r.errors.length > 0 ? { client_errors: r.errors } : {}),
  };
}

export function ImportClient({
  subjects,
  recentBatches,
}: {
  subjects: { id: string; label: string }[];
  recentBatches: Batch[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [subjectId, setSubjectId] = useState("");
  const [status, setStatus] = useState("draft");
  const [createMissing, setCreateMissing] = useState(true);
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState<{
    inserted: number;
    skipped: number;
    errors: number;
  } | null>(null);

  function downloadTemplate() {
    const csv = Papa.unparse([
      TEMPLATE_HEADERS,
      [
        "Which of the following is a component of Virchow triad?",
        "Endothelial injury",
        "Protein C activation",
        "Increased prostacyclin",
        "Thrombomodulin expression",
        "",
        "A",
        "Virchow triad: endothelial injury, abnormal flow, hypercoagulability.",
        "Robbins, Hemodynamic Disorders",
        "Robbins Basic Pathology",
        "Hemodynamic Disorders",
        "Thrombosis",
        "easy",
        "virchow|thrombosis",
      ],
    ]);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "medverse-question-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleFile(file: File) {
    setFilename(file.name);
    setSummary(null);
    const lower = file.name.toLowerCase();

    let records: Record<string, string>[] = [];
    if (lower.endsWith(".csv")) {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      records = parsed.data;
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
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

    setRows(
      records.map((raw, i) => ({
        row_number: i + 2, // header is row 1
        raw,
        errors: validateRow(raw),
      }))
    );
  }

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  async function runImport() {
    if (!subjectId) return void toast.error("Choose the target subject first.");
    setImporting(true);
    setSummary(null);
    try {
      const batchRes = await createImportBatch(filename, rows.length);
      if ("error" in batchRes && batchRes.error) throw new Error(batchRes.error);
      const batchId = (batchRes as { id: string }).id;

      // Every parsed row is sent — invalid ones carry `client_errors` so the
      // server records a permanent 'error' import_rows entry for them too,
      // instead of only showing up in this transient preview table.
      const payload = rows.map((r) => toImportRow(r, subjectId, status));
      const totals = { inserted: 0, skipped: 0, errors: 0 };
      const CHUNK = 100;
      for (let i = 0; i < payload.length; i += CHUNK) {
        setProgress(`Importing ${i + 1}–${Math.min(i + CHUNK, payload.length)} of ${payload.length}…`);
        const res = await importChunk(batchId, payload.slice(i, i + CHUNK), createMissing);
        if (res.error) throw new Error(res.error);
        totals.inserted += res.result!.inserted;
        totals.skipped += res.result!.skipped;
        totals.errors += res.result!.errors;
      }
      setSummary(totals);
      toast.success(
        `Import finished: ${totals.inserted} added, ${totals.skipped} duplicates skipped, ${totals.errors} errors.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      setProgress("");
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Prepare your file</CardTitle>
          <CardDescription>
            Columns: {TEMPLATE_HEADERS.join(", ")}. Tags separated by |.
            Book/chapter/topic are matched by name under the subject you pick
            (created automatically if allowed below).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={downloadTemplate}>
            Download CSV template
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload & preview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Target subject</Label>
              <Select value={subjectId || undefined} onValueChange={setSubjectId}>
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
            </div>
            <div className="grid gap-2">
              <Label>Import as</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
            }}
          />

          {rows.length > 0 && (
            <>
              <div className="flex gap-3 text-sm">
                <Badge variant="default">{validRows.length} valid</Badge>
                {invalidRows.length > 0 && (
                  <Badge variant="destructive">{invalidRows.length} with errors</Badge>
                )}
              </div>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead className="max-w-sm">Question</TableHead>
                      <TableHead>Correct</TableHead>
                      <TableHead>Chapter / Topic</TableHead>
                      <TableHead>Problems</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 200).map((r) => (
                      <TableRow key={r.row_number}>
                        <TableCell>{r.row_number}</TableCell>
                        <TableCell className="max-w-sm truncate">
                          {r.raw.question}
                        </TableCell>
                        <TableCell>{r.raw.correct}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.raw.chapter} / {r.raw.topic}
                        </TableCell>
                        <TableCell className="text-destructive">
                          {r.errors.join("; ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={runImport}
                  disabled={importing || rows.length === 0 || !subjectId}
                >
                  {importing
                    ? progress || "Importing…"
                    : `Import ${validRows.length} question${validRows.length === 1 ? "" : "s"}`}
                </Button>
                {invalidRows.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {invalidRows.length} row{invalidRows.length === 1 ? "" : "s"} with errors
                    will be recorded, not created.
                  </span>
                )}
              </div>
            </>
          )}

          {summary && (
            <p className="text-sm">
              Done: <b>{summary.inserted}</b> added,{" "}
              <b>{summary.skipped}</b> duplicates skipped,{" "}
              <b>{summary.errors}</b> errors.
            </p>
          )}
        </CardContent>
      </Card>

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
                    <TableCell>
                      {formatDateTime(b.created_at)}
                    </TableCell>
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
