"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createOspeStationDraft } from "@/lib/actions/ospe-stations";
import { isOspeStationImageFile } from "@/lib/study/upload-rules";
import { studyErrorMessage } from "@/lib/study/errors";
import { ospeBulkBatchError, validateOspeBulkItem } from "@/lib/admin/ospe-bulk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Row = {
  requestId: string; file: File; preview: string; title: string; answer: string;
  sortOrder: number; state: "ready" | "uploading" | "saved" | "failed"; error?: string; id?: string;
};

export function OspeBulkEditor({ yearId, subjects }: {
  yearId: string; subjects: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const previews = useRef<string[]>([]);
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, []);
  const locked = rows.some(row => row.state !== "ready");
  const remaining = rows.filter(row => row.state !== "saved");
  const saved = rows.length - remaining.length;

  function clearPreviews() {
    previews.current.forEach(url => URL.revokeObjectURL(url));
    previews.current.length = 0;
  }
  function pick(files: File[]) {
    if (locked || running.current) return;
    const batchError = ospeBulkBatchError(files.map(file => file.size));
    const imageError = files.map(file => isOspeStationImageFile(file)).find(Boolean);
    if (batchError || imageError) {
      setError(batchError ?? studyErrorMessage(imageError!));
      return;
    }
    clearPreviews();
    const next = files.map((file, i): Row => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { requestId: crypto.randomUUID(), file, preview,
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 200), answer: "",
        sortOrder: i, state: "ready" };
    });
    setRows(next);
    setError("");
  }

  function patch(id: string, update: Partial<Row>) {
    setRows(previous => previous.map(row => row.requestId === id ? { ...row, ...update } : row));
  }

  async function save() {
    if (running.current || !remaining.length || !subjects.some(s => s.id === subjectId)) {
      setError("Choose the subject and complete the manifest.");
      return;
    }
    const invalid = remaining.map(row => validateOspeBulkItem(row)).find(Boolean);
    if (invalid) { setError(invalid); return; }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      // One image per request: preserve the existing server-action body limit.
      for (const row of remaining) {
        patch(row.requestId, { state: "uploading", error: undefined });
        try {
          const fd = new FormData();
          fd.set("requestId", row.requestId);
          fd.set("yearId", yearId);
          fd.set("subjectId", subjectId);
          fd.set("title", row.title);
          fd.set("answer", row.answer);
          fd.set("sortOrder", String(row.sortOrder));
          fd.set("image", row.file);
          const result = await createOspeStationDraft(fd);
          if ("error" in result) {
            patch(row.requestId, { state: "failed", error: result.error });
            setError("Batch stopped. Retry this same manifest before continuing.");
            break;
          }
          patch(row.requestId, { state: "saved", id: result.id });
        } catch {
          patch(row.requestId, { state: "failed", error: "Response not confirmed. Retry this exact row." });
          setError("Batch stopped. Do not reselect files; retry the same manifest.");
          break;
        }
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return <div className="grid gap-4" data-testid="ospe-bulk-editor">
    <p className="text-sm text-muted-foreground">Choose up to 20 images (100 MiB per batch), edit each title and answer, then save as drafts. Review before publishing. Keep this page open until the batch finishes.</p>
    <label className="grid gap-1 text-sm">Block / subject
      <select className="rounded-md border bg-background p-2" value={subjectId}
        disabled={busy || locked} onChange={e => setSubjectId(e.target.value)}>
        <option value="">Choose subject</option>
        {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm">Station images
      <Input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || locked}
        onChange={e => { pick(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p role="status" className="text-sm">{saved} of {rows.length} drafts saved</p>
    {rows.map((row, index) => <section key={row.requestId} className="grid gap-2 rounded-lg border p-3" data-testid="ospe-bulk-row">
      <div className="flex flex-wrap items-center gap-3">
        {/* Local preview; no object is uploaded until Save. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.preview} alt="" className="h-20 w-28 rounded border object-contain" />
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm">{index + 1}. {row.file.name}</p>
          <p className="text-xs text-muted-foreground">{row.state}</p>
          {row.id && <Link className="text-sm underline" href={"/admin/ospe-stations/" + row.id}>Edit saved draft</Link>}
        </div>
        {row.state === "ready" && <Button type="button" variant="outline" disabled={busy || locked}
          onClick={() => { URL.revokeObjectURL(row.preview); setRows(previous => previous.filter(r => r.requestId !== row.requestId)); }}>Remove</Button>}
      </div>
      <label className="grid gap-1 text-sm">Title
        <Input value={row.title} maxLength={200} disabled={busy || locked}
          onChange={e => patch(row.requestId, { title: e.target.value })} />
      </label>
      <label className="grid gap-1 text-sm">Answer
        <Textarea value={row.answer} maxLength={20_000} disabled={busy || locked}
          onChange={e => patch(row.requestId, { answer: e.target.value })} />
      </label>
      {row.error && <p className="text-sm text-destructive" role="alert">{row.error}</p>}
    </section>)}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || !remaining.length || !subjectId}
        onClick={() => void save()}>{busy ? "Saving…" : locked ? "Retry remaining drafts" : "Save drafts"}</Button>
      <Button type="button" variant="outline" disabled={busy || !rows.length} onClick={() => {
        if (locked && !window.confirm("Clear this manifest? Saved or unconfirmed drafts may already exist. Check the station list before importing the same files again.")) return;
        clearPreviews(); setRows([]); setError("");
      }}>Clear batch</Button>
      <Button asChild variant="outline"><Link href={"/admin/ospe-stations?year=" + encodeURIComponent(yearId)}>Station list</Link></Button>
    </div>
  </div>;
}
