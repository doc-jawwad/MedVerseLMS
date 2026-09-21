"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  createOneLinerImportBatch,
  importOneLinerChunk,
  getOneLinerImportReport,
} from "@/lib/actions/import";
import {
  parseOneLinerCsvRow,
  validateOneLinerCsvHeaders,
  ONE_LINER_REQUIRED_HEADERS,
} from "@/lib/questions/one-liner-csv-import";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ImportRow = {
  row_number: number;
  title: string;
  body: string;
  subject: string;
  status: string;
  client_errors?: string[];
};

type ReportRow = {
  row_number: number;
  outcome: string;
  error_message: string | null;
};

export function ImportOneLinersClient({ yearId }: { yearId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReportRow[] | null>(null);

  function handleFile(file: File) {
    setReport(null);
    setRows([]);
    setHeaderErrors([]);
    setFilename(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const missing = validateOneLinerCsvHeaders(results.meta.fields ?? []);
        if (missing.length > 0) {
          setHeaderErrors(missing);
          return;
        }
        const parsed = (results.data as Record<string, string>[]).map((raw, i) =>
          parseOneLinerCsvRow(raw, i + 1)
        );
        setRows(parsed);
      },
      error(err) {
        toast.error(`Parse error: ${err.message}`);
      },
    });
  }

  const errorCount = rows.filter((r) => r.client_errors?.length).length;
  const canImport = rows.length > 0 && errorCount === 0 && !busy;

  async function runImport() {
    setBusy(true);
    try {
      const batchRes = await createOneLinerImportBatch(yearId, filename, rows.length);
      if (!("id" in batchRes)) {
        toast.error("Failed to create import batch");
        return;
      }
      const chunkRes = await importOneLinerChunk(yearId, batchRes.id, rows);
      if ("error" in chunkRes && chunkRes.error) {
        toast.error(chunkRes.error);
        return;
      }
      const { rows: reportRows } = await getOneLinerImportReport(batchRes.id);
      setReport(reportRows as ReportRow[]);
      const r = (chunkRes as { result: { inserted: number; skipped: number; errors: number } }).result;
      toast.success(`Done: ${r.inserted} inserted, ${r.skipped} skipped, ${r.errors} errors`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Required columns: <code>{ONE_LINER_REQUIRED_HEADERS.join(", ")}</code>.
          Optional: <code>subject, status</code> (draft / published).
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          Choose CSV file
        </Button>
        {filename && <span className="ml-3 text-sm text-muted-foreground">{filename}</span>}
      </div>

      {headerErrors.length > 0 && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          Missing required columns: {headerErrors.join(", ")}
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid gap-3">
          <p className="text-sm font-medium">
            {rows.length} rows parsed — {errorCount} with errors
          </p>
          <div className="max-h-72 overflow-auto rounded-md border text-sm">
            <table className="w-full">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row_number} className={r.client_errors?.length ? "bg-destructive/5" : ""}>
                    <td className="px-3 py-1">{r.row_number}</td>
                    <td className="px-3 py-1 max-w-xs truncate">{r.title || "—"}</td>
                    <td className="px-3 py-1"><Badge variant="outline">{r.status}</Badge></td>
                    <td className="px-3 py-1 text-destructive text-xs">
                      {r.client_errors?.join("; ") ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={runImport} disabled={!canImport}>
            {busy ? "Importing…" : `Import ${rows.length} one-liners`}
          </Button>
        </div>
      )}

      {report && (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">Import report</p>
          <div className="max-h-60 overflow-auto rounded-md border text-sm">
            <table className="w-full">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Outcome</th>
                  <th className="px-3 py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.row_number} className={r.outcome === "error" ? "bg-destructive/5" : ""}>
                    <td className="px-3 py-1">{r.row_number}</td>
                    <td className="px-3 py-1"><Badge variant={r.outcome === "inserted" ? "default" : "secondary"}>{r.outcome}</Badge></td>
                    <td className="px-3 py-1 text-xs text-destructive">{r.error_message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
