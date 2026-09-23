"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  abortStudyPdfUpload,
  beginStudyPdfUpload,
  completeStudyPdfUpload,
  signStudyPdfUploadParts,
} from "@/lib/actions/study-pdf-upload";
import { studyErrorMessage } from "@/lib/study/errors";
import { isStudyPdfMeta } from "@/lib/study/upload-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type UploadState =
  | "idle"
  | "starting"
  | "uploading"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled";

const PART_CONCURRENCY = 3;
const PART_MAX_ATTEMPTS = 4;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function putWithProgress(
  url: string,
  body: Blob,
  contentType: string | undefined,
  onProgress: (loaded: number) => void,
  signal: AbortSignal
): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader("ETag") });
      } else {
        reject(new Error(`upload_http_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.onabort = () => reject(new Error("upload_cancelled"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

export function StudyPdfUploader({
  folderId,
  onComplete,
}: {
  folderId: string;
  onComplete?: () => void;
}) {
  const [state, setState] = useState<UploadState>("idle");
  const [fileName, setFileName] = useState("");
  const [totalBytes, setTotalBytes] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [speedBps, setSpeedBps] = useState(0);
  const [statusLine, setStatusLine] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const partLoadedRef = useRef<Map<number, number>>(new Map());
  const startedAtRef = useRef(0);

  function refreshProgress() {
    let sum = 0;
    for (const v of partLoadedRef.current.values()) sum += v;
    setUploadedBytes(sum);
    const elapsed = (Date.now() - startedAtRef.current) / 1000;
    if (elapsed > 0.25) setSpeedBps(sum / elapsed);
  }

  async function cancelUpload() {
    abortRef.current?.abort();
    const token = sessionTokenRef.current;
    setState("cancelled");
    setStatusLine("Cancelling…");
    if (token) {
      try {
        await abortStudyPdfUpload({ sessionToken: token });
      } catch {
        /* best-effort */
      }
    }
    sessionTokenRef.current = null;
    setStatusLine("Upload cancelled");
    toast.message("Upload cancelled");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "");
    const publish = data.get("publish") === "1";
    const file = data.get("file");
    const cover = data.get("cover");

    if (!title) {
      toast.error("Title and folder are required.");
      return;
    }
    if (!(file instanceof File) || file.size === 0) {
      toast.error(studyErrorMessage("pdf_empty"));
      return;
    }
    const metaErr = isStudyPdfMeta(file);
    if (metaErr) {
      toast.error(studyErrorMessage(metaErr));
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;
    sessionTokenRef.current = null;
    partLoadedRef.current = new Map();
    startedAtRef.current = Date.now();
    setFileName(file.name);
    setTotalBytes(file.size);
    setUploadedBytes(0);
    setSpeedBps(0);
    setState("starting");
    setStatusLine("Authorizing upload…");

    let sessionToken: string | null = null;
    try {
      const began = await beginStudyPdfUpload({
        folderId,
        fileName: file.name,
        byteSize: file.size,
        contentType: file.type || "application/pdf",
      });
      if ("error" in began && began.error) throw new Error(began.error);
      if (!("sessionToken" in began)) throw new Error("upload_session_invalid");
      sessionToken = began.sessionToken;
      sessionTokenRef.current = sessionToken;
      setState("uploading");

      let parts: Array<{ partNumber: number; etag: string }> | undefined;

      if (began.mode === "put") {
        setStatusLine("Uploading…");
        partLoadedRef.current.set(1, 0);
        await putWithProgress(
          began.putUrl,
          file,
          began.contentType,
          (loaded) => {
            partLoadedRef.current.set(1, loaded);
            refreshProgress();
          },
          abort.signal
        );
        partLoadedRef.current.set(1, file.size);
        refreshProgress();
      } else {
        setStatusLine(`Uploading ${began.partCount} parts…`);
        const { partSize, partCount } = began;
        const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
        const urlByPart = new Map<number, string>();
        for (let i = 0; i < partNumbers.length; i += 40) {
          const batch = partNumbers.slice(i, i + 40);
          const signed = await signStudyPdfUploadParts({
            sessionToken,
            partNumbers: batch,
          });
          if ("error" in signed && signed.error) throw new Error(signed.error);
          if (!("urls" in signed)) throw new Error("upload_session_invalid");
          for (const u of signed.urls) urlByPart.set(u.partNumber, u.url);
        }

        const collected: Array<{ partNumber: number; etag: string }> = [];
        await mapPool(partNumbers, PART_CONCURRENCY, async (partNumber) => {
          if (abort.signal.aborted) throw new Error("upload_cancelled");
          const start = (partNumber - 1) * partSize;
          const end = Math.min(start + partSize, file.size);
          // Empty type so the browser does not send Content-Type (not in the
          // UploadPart signature). file.slice() would inherit application/pdf.
          const blob = new Blob([file.slice(start, end)], { type: "" });
          let lastErr: unknown;
          for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
            if (abort.signal.aborted) throw new Error("upload_cancelled");
            try {
              let url = urlByPart.get(partNumber);
              if (!url || attempt > 1) {
                const resigned = await signStudyPdfUploadParts({
                  sessionToken: sessionToken!,
                  partNumbers: [partNumber],
                });
                if ("error" in resigned && resigned.error) {
                  throw new Error(resigned.error);
                }
                if (!("urls" in resigned) || !resigned.urls[0]) {
                  throw new Error("upload_session_invalid");
                }
                url = resigned.urls[0].url;
                urlByPart.set(partNumber, url);
              }
              partLoadedRef.current.set(partNumber, 0);
              const { etag } = await putWithProgress(
                url,
                blob,
                undefined,
                (loaded) => {
                  partLoadedRef.current.set(partNumber, loaded);
                  refreshProgress();
                },
                abort.signal
              );
              if (!etag) throw new Error("upload_part_missing_etag");
              partLoadedRef.current.set(partNumber, blob.size);
              refreshProgress();
              collected.push({ partNumber, etag });
              return;
            } catch (err) {
              lastErr = err;
              if (err instanceof Error && err.message === "upload_cancelled") {
                throw err;
              }
              setStatusLine(
                `Part ${partNumber} failed (attempt ${attempt}/${PART_MAX_ATTEMPTS})…`
              );
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }
          throw lastErr instanceof Error
            ? lastErr
            : new Error("upload_part_failed");
        });
        parts = collected;
      }

      if (abort.signal.aborted) throw new Error("upload_cancelled");
      setState("finalizing");
      setStatusLine("Verifying and saving…");

      const completed = await completeStudyPdfUpload({
        sessionToken,
        title,
        description,
        publish,
        parts,
        cover: cover instanceof File && cover.size > 0 ? cover : null,
      });
      if ("error" in completed && completed.error) {
        throw new Error(completed.error);
      }

      sessionTokenRef.current = null;
      setState("done");
      setUploadedBytes(file.size);
      setStatusLine("Saved");
      toast.success("PDF saved");
      form.reset();
      onComplete?.();
      setTimeout(() => {
        setState("idle");
        setStatusLine("");
        setFileName("");
        setTotalBytes(0);
        setUploadedBytes(0);
        setSpeedBps(0);
      }, 1200);
    } catch (err) {
      const code = err instanceof Error ? err.message : "upload_failed";
      if (code === "upload_cancelled") {
        setState("cancelled");
        setStatusLine("Upload cancelled");
        return;
      }
      if (sessionToken) {
        try {
          await abortStudyPdfUpload({ sessionToken });
        } catch {
          /* best-effort */
        }
      }
      sessionTokenRef.current = null;
      setState("error");
      setStatusLine(studyErrorMessage(code));
      toast.error(studyErrorMessage(code));
    }
  }

  const pct =
    totalBytes > 0
      ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
      : 0;
  const remaining =
    speedBps > 0 ? (totalBytes - uploadedBytes) / speedBps : Number.NaN;
  const busy =
    state === "starting" ||
    state === "uploading" ||
    state === "finalizing";

  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={handleSubmit}>
      <Input name="title" required placeholder="Title" disabled={busy} />
      <Input
        name="description"
        placeholder="Description (optional)"
        disabled={busy}
      />
      <div className="grid gap-1 text-sm">
        <Label>PDF file</Label>
        <Input
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          disabled={busy}
        />
      </div>
      <div className="grid gap-1 text-sm">
        <Label>Cover (optional, max 2 MB)</Label>
        <Input
          name="cover"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="publish"
          value="1"
          defaultChecked
          disabled={busy}
        />
        Publish now
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy} className="w-fit">
          {busy ? "Uploading…" : "Add PDF"}
        </Button>
        {busy && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void cancelUpload()}
          >
            Cancel
          </Button>
        )}
      </div>

      {(busy ||
        state === "done" ||
        state === "error" ||
        state === "cancelled") &&
        totalBytes > 0 && (
          <div className="sm:col-span-2 grid gap-1 text-sm">
            <div className="flex flex-wrap justify-between gap-2 text-muted-foreground">
              <span className="truncate">{fileName}</span>
              <span>
                {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)} ({pct}
                %)
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>{statusLine || state}</span>
              <span>
                {speedBps > 0
                  ? `${formatBytes(speedBps)}/s · ETA ${formatEta(remaining)}`
                  : null}
              </span>
            </div>
          </div>
        )}
    </form>
  );
}
