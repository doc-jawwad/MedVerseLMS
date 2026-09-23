"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  estimateOfflineQuota,
  formatByteSize,
  getOfflineMeta,
  purgeExpiredOffline,
  readOfflinePdfBytes,
  removeOfflinePdf,
  savePdfForOffline,
  totalOfflineBytes,
  touchOfflineEntitlement,
  type OfflinePdfMeta,
} from "@/lib/study/offline-pdf-store";

type PdfjsLib = typeof import("pdfjs-dist");
type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
type PdfPage = import("pdfjs-dist").PDFPageProxy;

const ENTITLEMENT_TTL_MS = 24 * 60 * 60 * 1000;

type OfflineUi =
  | "checking"
  | "online_only"
  | "saving"
  | "offline_ready"
  | "offline_expired"
  | "offline_unavailable"
  | "save_failed";

function formatPct(loaded: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.round((loaded / total) * 100))}%`;
}

function progressKey(materialId: string): string {
  return `mv-pdf-page:${materialId}`;
}

function readSavedPage(materialId: string): number | null {
  try {
    const raw = localStorage.getItem(progressKey(materialId));
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

function writeSavedPage(materialId: string, page: number): void {
  try {
    localStorage.setItem(progressKey(materialId), String(page));
  } catch {
    /* quota / private mode */
  }
}

export function PdfViewer({
  materialId,
  title,
  watermarkName,
  watermarkCollege,
}: {
  materialId: string;
  title: string;
  watermarkName?: string;
  watermarkCollege?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const pdfjsRef = useRef<PdfjsLib | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const offlineAbortRef = useRef<AbortController | null>(null);
  const loadGenRef = useRef(0);
  const loadingTaskRef = useRef<{ destroy: () => Promise<unknown> } | null>(
    null
  );

  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [outline, setOutline] = useState<
    Array<{ title: string; pageNumber: number }>
  >([]);
  const [showOutline, setShowOutline] = useState(false);
  const [offlineUi, setOfflineUi] = useState<OfflineUi>("checking");
  const [savePct, setSavePct] = useState("");
  const [pendingSaveSize, setPendingSaveSize] = useState<number | null>(null);
  const [offlineUsageLabel, setOfflineUsageLabel] = useState("");
  const [usingOffline, setUsingOffline] = useState(false);

  const sourceUrl = `/api/study-content/${materialId}`;

  const watermarkLine = [watermarkName, watermarkCollege, "MedVerse"]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" · ");

  const refreshOfflineUsage = useCallback(async () => {
    try {
      const used = await totalOfflineBytes();
      const quota = await estimateOfflineQuota();
      if (quota) {
        setOfflineUsageLabel(
          `Offline library ${formatByteSize(used)} · device free ${formatByteSize(quota.remaining)}`
        );
      } else if (used > 0) {
        setOfflineUsageLabel(`Offline library ${formatByteSize(used)}`);
      } else {
        setOfflineUsageLabel("");
      }
    } catch {
      setOfflineUsageLabel("");
    }
  }, []);

  const renderPage = useCallback(
    async (doc: PdfDocument, pageNum: number, zoom: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      renderTaskRef.current?.cancel();
      const pdfPage: PdfPage = await doc.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: zoom });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = pdfPage.render({
        canvasContext: ctx,
        viewport,
      });
      renderTaskRef.current = task;
      await task.promise;
    },
    []
  );

  const loadDocument = useCallback(
    async (opts: { preferOffline: boolean }) => {
      const gen = ++loadGenRef.current;
      setLoading(true);
      setError(null);
      setUsingOffline(false);
      try {
        await purgeExpiredOffline();
        if (gen !== loadGenRef.current) return;
        // Defer quota UI work so first page is not blocked on estimate().
        void refreshOfflineUsage();
        const pdfjs = await import("pdfjs-dist");
        if (gen !== loadGenRef.current) return;
        pdfjsRef.current = pdfjs;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        let loadingTask: {
          promise: Promise<PdfDocument>;
          destroy: () => Promise<unknown>;
        } | null = null;
        let offlineMeta: OfflinePdfMeta | null = null;

        if (opts.preferOffline || !navigator.onLine) {
          offlineMeta = await getOfflineMeta(materialId);
          const bytes = offlineMeta
            ? await readOfflinePdfBytes(materialId)
            : null;
          if (gen !== loadGenRef.current) return;
          if (bytes) {
            loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
            setUsingOffline(true);
            setOfflineUi("offline_ready");
          } else if (!navigator.onLine) {
            if (
              offlineMeta &&
              offlineMeta.entitlementExpiresAt > 0 &&
              Date.now() > offlineMeta.entitlementExpiresAt
            ) {
              setOfflineUi("offline_expired");
              throw new Error(
                "Offline access expired — connect to update access."
              );
            }
            setOfflineUi("offline_unavailable");
            throw new Error(
              "Connect to the internet to read this document."
            );
          }
        }

        if (!loadingTask) {
          // Online range/stream path — PDF.js issues Range requests.
          const probe = await fetch(sourceUrl, {
            method: "HEAD",
            credentials: "same-origin",
            cache: "no-store",
          });
          if (gen !== loadGenRef.current) return;
          if (probe.status === 403) {
            await removeOfflinePdf(materialId);
            setOfflineUi("online_only");
            throw new Error("You do not have access to this PDF.");
          }
          if (!probe.ok) throw new Error("Could not load this PDF.");

          const rev =
            probe.headers.get("etag") ||
            probe.headers.get("content-length") ||
            "";
          offlineMeta = await getOfflineMeta(materialId);
          if (
            offlineMeta &&
            rev &&
            offlineMeta.contentRevision &&
            offlineMeta.contentRevision !== rev
          ) {
            await removeOfflinePdf(materialId);
            offlineMeta = null;
            toast.message("Offline copy outdated — removed.");
          }

          const expiresAt = Date.now() + ENTITLEMENT_TTL_MS;
          await touchOfflineEntitlement(materialId, expiresAt);
          if (gen !== loadGenRef.current) return;
          offlineMeta = await getOfflineMeta(materialId);
          setOfflineUi(offlineMeta ? "offline_ready" : "online_only");

          // Range-only: avoid a competing full-body stream that can stall
          // behind aborted connections through the Next/Caddy proxy.
          loadingTask = pdfjs.getDocument({
            url: sourceUrl,
            withCredentials: true,
            disableRange: false,
            disableStream: true,
            disableAutoFetch: true,
            rangeChunkSize: 512 * 1024,
          });
        }

        loadingTaskRef.current?.destroy().catch(() => undefined);
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (gen !== loadGenRef.current) {
          doc.destroy().catch(() => undefined);
          return;
        }
        pdfRef.current?.destroy().catch(() => undefined);
        pdfRef.current = doc;
        setPageCount(doc.numPages);
        const saved = readSavedPage(materialId);
        const startPage =
          saved && saved >= 1 && saved <= doc.numPages ? saved : 1;
        setPage(startPage);
        await renderPage(doc, startPage, scale);
        if (gen !== loadGenRef.current) return;

        try {
          const rawOutline = await doc.getOutline();
          if (rawOutline?.length) {
            const items: Array<{ title: string; pageNumber: number }> = [];
            for (const node of rawOutline.slice(0, 80)) {
              try {
                const dest = node.dest;
                let pageIndex = 0;
                if (typeof dest === "string") {
                  const d = await doc.getDestination(dest);
                  if (d) {
                    const ref = d[0];
                    pageIndex = await doc.getPageIndex(ref);
                  }
                } else if (Array.isArray(dest) && dest[0]) {
                  pageIndex = await doc.getPageIndex(dest[0]);
                }
                items.push({
                  title: String(node.title ?? "Section"),
                  pageNumber: pageIndex + 1,
                });
              } catch {
                /* skip bad outline nodes */
              }
            }
            setOutline(items);
          } else {
            setOutline([]);
          }
        } catch {
          setOutline([]);
        }

        if (gen !== loadGenRef.current) return;
        setLoading(false);
        void refreshOfflineUsage();
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : "Could not load this PDF.");
      }
    },
    [materialId, refreshOfflineUsage, renderPage, scale, sourceUrl]
  );

  useEffect(() => {
    void loadDocument({ preferOffline: !navigator.onLine });
    return () => {
      loadGenRef.current += 1;
      renderTaskRef.current?.cancel();
      loadingTaskRef.current?.destroy().catch(() => undefined);
      loadingTaskRef.current = null;
      pdfRef.current?.destroy().catch(() => undefined);
      pdfRef.current = null;
      offlineAbortRef.current?.abort();
    };
    // Intentionally once per materialId — scale changes re-render below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  useEffect(() => {
    const doc = pdfRef.current;
    if (!doc || loading) return;
    writeSavedPage(materialId, page);
    void renderPage(doc, page, scale);
  }, [page, scale, loading, materialId, renderPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (loading || error) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        goPage(page + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goPage(page - 1);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))));
      } else if (e.key === "-") {
        e.preventDefault();
        setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, page, pageCount]);

  const goPage = (n: number) => {
    if (pageCount <= 0) return;
    setPage(Math.min(pageCount, Math.max(1, n)));
  };

  const onJump = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const n = Number(fd.get("page"));
    if (Number.isFinite(n)) goPage(n);
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    const doc = pdfRef.current;
    const q = searchQuery.trim();
    if (!doc || !q) return;
    setSearchStatus("Searching…");
    const needle = q.toLowerCase();
    for (let i = page; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const text = await p.getTextContent();
      const hay = text.items
        .map((it) => ("str" in it ? String(it.str) : ""))
        .join(" ")
        .toLowerCase();
      if (hay.includes(needle)) {
        setPage(i);
        setSearchStatus(`Found on page ${i}`);
        return;
      }
    }
    for (let i = 1; i < page; i++) {
      const p = await doc.getPage(i);
      const text = await p.getTextContent();
      const hay = text.items
        .map((it) => ("str" in it ? String(it.str) : ""))
        .join(" ")
        .toLowerCase();
      if (hay.includes(needle)) {
        setPage(i);
        setSearchStatus(`Found on page ${i}`);
        return;
      }
    }
    setSearchStatus("No matches");
  };

  const fullscreen = () => {
    const node = containerRef.current;
    if (!node) return;
    void node.requestFullscreen?.();
  };

  const runOfflineSave = async () => {
    offlineAbortRef.current?.abort();
    const ac = new AbortController();
    offlineAbortRef.current = ac;
    setOfflineUi("saving");
    setSavePct("0%");
    try {
      const probe = await fetch(sourceUrl, {
        method: "HEAD",
        credentials: "same-origin",
        cache: "no-store",
        signal: ac.signal,
      });
      if (probe.status === 403) throw new Error("study_object_denied");
      if (!probe.ok) throw new Error("Could not authorize offline save.");
      const total = Number(probe.headers.get("content-length") ?? "0");
      const rev =
        probe.headers.get("etag") ||
        probe.headers.get("content-length") ||
        String(Date.now());
      await savePdfForOffline({
        materialId,
        title,
        contentRevision: rev,
        entitlementExpiresAt: Date.now() + ENTITLEMENT_TTL_MS,
        signal: ac.signal,
        onProgress: ({ loaded, total: t }) => {
          setSavePct(formatPct(loaded, t > 0 ? t : total));
        },
      });
      setPendingSaveSize(null);
      setOfflineUi("offline_ready");
      await refreshOfflineUsage();
      toast.success("Saved for offline reading");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "offline_failed";
      if (msg === "offline_cancelled") {
        setOfflineUi("online_only");
        setPendingSaveSize(null);
        toast.message("Offline save cancelled");
        return;
      }
      if (msg === "study_object_denied") {
        setOfflineUi("online_only");
        setPendingSaveSize(null);
        toast.error("You do not have access to this PDF.");
        return;
      }
      setOfflineUi("save_failed");
      toast.error(
        msg.startsWith("offline_range_failed")
          ? `Could not save for offline (${msg}).`
          : "Could not save for offline."
      );
    }
  };

  const startOfflineSave = async () => {
    try {
      const probe = await fetch(sourceUrl, {
        method: "HEAD",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (probe.status === 403) {
        toast.error("You do not have access to this PDF.");
        return;
      }
      if (!probe.ok) {
        toast.error("Could not check file size.");
        return;
      }
      const total = Number(probe.headers.get("content-length") ?? "0");
      if (!Number.isFinite(total) || total <= 0) {
        toast.error("Could not determine file size for offline save.");
        return;
      }
      const quota = await estimateOfflineQuota();
      if (quota && total > quota.remaining) {
        toast.error(
          `Not enough device storage (${formatByteSize(total)} needed, ${formatByteSize(quota.remaining)} free).`
        );
        setOfflineUi("online_only");
        return;
      }
      setPendingSaveSize(total);
      await refreshOfflineUsage();
    } catch {
      toast.error("Could not prepare offline save.");
    }
  };

  const cancelOfflineSave = () => {
    offlineAbortRef.current?.abort();
  };

  const clearOffline = async () => {
    await removeOfflinePdf(materialId);
    setOfflineUi("online_only");
    setPendingSaveSize(null);
    await refreshOfflineUsage();
    toast.message("Removed offline copy");
  };

  const offlineLabel = (() => {
    switch (offlineUi) {
      case "checking":
        return "Checking access…";
      case "online_only":
        return "Available online";
      case "saving":
        return `Saving for offline — ${savePct}`;
      case "offline_ready":
        return usingOffline
          ? "Available offline (reading cached copy)"
          : "Available offline";
      case "offline_expired":
        return "Offline access expired — connect to update access.";
      case "offline_unavailable":
        return "Connect to the internet to read this document.";
      case "save_failed":
        return "Offline save failed — retry when ready.";
      default:
        return "";
    }
  })();

  if (loading) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground"
        data-testid="pdf-loading"
      >
        <p>Opening document…</p>
        <p className="text-xs">
          Large files load by page range — you can read before the full file
          arrives.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="grid gap-4 rounded-xl border border-destructive/30 bg-card px-4 py-8 text-center"
        data-testid="pdf-error"
      >
        <p className="text-sm text-destructive">{error}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void loadDocument({ preferOffline: false })}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="grid gap-2 rounded-xl border bg-card p-2 sm:gap-3 sm:p-3"
      data-testid="pdf-viewer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="grid gap-0.5">
          <span data-testid="pdf-offline-status">{offlineLabel}</span>
          {offlineUsageLabel ? (
            <span data-testid="pdf-offline-usage">{offlineUsageLabel}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {offlineUi === "saving" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelOfflineSave}
            >
              Cancel save
            </Button>
          ) : pendingSaveSize != null ? (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => void runOfflineSave()}
                data-testid="pdf-offline-confirm"
              >
                Confirm save ({formatByteSize(pendingSaveSize)})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPendingSaveSize(null)}
              >
                Cancel
              </Button>
            </>
          ) : offlineUi === "save_failed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void startOfflineSave()}
              data-testid="pdf-offline-retry"
            >
              Retry offline save
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={offlineUi === "checking"}
              onClick={() => void startOfflineSave()}
              data-testid="pdf-save-offline"
            >
              Save for Offline
            </Button>
          )}
          {offlineUi === "offline_ready" && (
            <>
              {!usingOffline && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void loadDocument({ preferOffline: true })}
                  data-testid="pdf-open-offline"
                >
                  Open offline copy
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void clearOffline()}
              >
                Remove offline
              </Button>
            </>
          )}
          <Button type="button" size="sm" variant="outline" onClick={fullscreen}>
            Fullscreen
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => goPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => goPage(page + 1)}
        >
          Next
        </Button>
        <form className="flex items-center gap-1" onSubmit={onJump}>
          <Input
            name="page"
            type="number"
            min={1}
            max={pageCount || 1}
            defaultValue={page}
            key={page}
            className="h-8 w-14 sm:w-16"
            aria-label="Page number"
          />
          <span className="text-xs text-muted-foreground">/ {pageCount}</span>
          <Button type="submit" size="sm" variant="ghost">
            Go
          </Button>
        </form>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
        >
          Zoom −
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}
        >
          Zoom +
        </Button>
        <span className="text-xs text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        {outline.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowOutline((v) => !v)}
          >
            Outline
          </Button>
        )}
      </div>

      <form className="flex flex-wrap items-center gap-2" onSubmit={onSearch}>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search in document"
          className="h-8 max-w-xs"
        />
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
        {searchStatus ? (
          <span className="text-xs text-muted-foreground">{searchStatus}</span>
        ) : null}
      </form>

      {showOutline && outline.length > 0 && (
        <div className="max-h-40 overflow-auto rounded border bg-muted/30 p-2 text-sm">
          {outline.map((item, idx) => (
            <button
              key={`${item.pageNumber}-${idx}`}
              type="button"
              className="block w-full truncate px-1 py-0.5 text-left hover:bg-muted"
              onClick={() => goPage(item.pageNumber)}
            >
              {item.title}{" "}
              <span className="text-muted-foreground">p.{item.pageNumber}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative overflow-auto rounded border bg-neutral-100">
        <canvas ref={canvasRef} className="mx-auto block max-w-full" />
        {watermarkLine ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] font-medium tracking-wide text-black/25 select-none"
            aria-hidden
          >
            {watermarkLine}
          </div>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        In-app reader only — no public file link. Offline copies stay inside
        MedVerse and expire when access ends. Arrow keys change pages.
      </p>
    </div>
  );
}
