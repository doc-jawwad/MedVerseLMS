"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createOnlinePdfRangeTransport,
  createOpfsPdfRangeTransport,
  estimateOfflineQuota,
  formatByteSize,
  getOfflineMeta,
  markOfflineSaveFailed,
  markOfflineSavePending,
  purgeExpiredOffline,
  removeOfflinePdf,
  savePdfForOffline,
  totalOfflineBytes,
  touchOfflineEntitlement,
  type OfflinePdfMeta,
} from "@/lib/study/offline-pdf-store";
import { requestCacheOfflineReader } from "@/lib/pwa/offline-shell";
import {
  clientRectsToPdfRects,
  createPdfHighlight,
  deletePdfHighlight,
  listPdfHighlights,
  pdfRectsToViewportBoxes,
  type PdfHighlightRow,
} from "@/lib/study/pdf-highlights";
import "@/styles/pdf-text-layer.css";

type PdfjsLib = typeof import("pdfjs-dist");
type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
type PdfPage = import("pdfjs-dist").PDFPageProxy;
type PdfViewport = ReturnType<PdfPage["getViewport"]>;

const ENTITLEMENT_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.15;

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
  preferOfflineDefault = false,
}: {
  materialId: string;
  title: string;
  watermarkName?: string;
  watermarkCollege?: string;
  /** When true (Offline Library reader), prefer OPFS ranges even while online. */
  preferOfflineDefault?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const pageStageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const pdfjsRef = useRef<PdfjsLib | null>(null);
  const viewportRef = useRef<PdfViewport | null>(null);
  const textLayerTaskRef = useRef<{ cancel: () => void } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const offlineAbortRef = useRef<AbortController | null>(null);
  const onlineLoadAbortRef = useRef<AbortController | null>(null);
  const loadGenRef = useRef(0);
  const loadingTaskRef = useRef<{ destroy: () => Promise<unknown> } | null>(
    null
  );
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
  } | null>(null);

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
  const [highlights, setHighlights] = useState<PdfHighlightRow[]>([]);
  const highlightsRef = useRef<PdfHighlightRow[]>([]);
  highlightsRef.current = highlights;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<{
    rects: ReturnType<typeof clientRectsToPdfRects>;
    text: string;
  } | null>(null);

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

  const paintHighlights = useCallback(
    (viewport: PdfViewport, pageNum: number, rows: PdfHighlightRow[]) => {
      const layer = highlightLayerRef.current;
      if (!layer) return;
      layer.replaceChildren();
      const pageRows = rows.filter((h) => h.page_number === pageNum);
      for (const row of pageRows) {
        const boxes = pdfRectsToViewportBoxes(viewport, row.rects);
        for (const box of boxes) {
          const mark = document.createElement("button");
          mark.type = "button";
          mark.className = "pdf-highlight-mark";
          mark.style.left = `${box.left}px`;
          mark.style.top = `${box.top}px`;
          mark.style.width = `${box.width}px`;
          mark.style.height = `${box.height}px`;
          mark.style.background = row.color || "#fde047";
          mark.title = "Remove highlight";
          mark.setAttribute("data-testid", "pdf-highlight-mark");
          mark.setAttribute("data-highlight-id", row.id);
          mark.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void (async () => {
              try {
                await deletePdfHighlight(row.id);
                setHighlights((prev) => prev.filter((h) => h.id !== row.id));
                toast.message("Highlight removed");
              } catch {
                toast.error("Could not remove highlight.");
              }
            })();
          });
          layer.appendChild(mark);
        }
      }
    },
    []
  );

  const renderPage = useCallback(
    async (doc: PdfDocument, pageNum: number, zoom: number) => {
      const canvas = canvasRef.current;
      const textLayerEl = textLayerRef.current;
      const stage = pageStageRef.current;
      const pdfjs = pdfjsRef.current;
      if (!canvas || !textLayerEl || !stage || !pdfjs) return;

      renderTaskRef.current?.cancel();
      textLayerTaskRef.current?.cancel();
      textLayerEl.replaceChildren();
      setPendingHighlight(null);

      const pdfPage: PdfPage = await doc.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: zoom });
      viewportRef.current = viewport;

      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      stage.style.width = `${Math.floor(viewport.width)}px`;
      stage.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

      const task = pdfPage.render({
        canvasContext: ctx,
        viewport,
      });
      renderTaskRef.current = task;
      await task.promise;

      textLayerEl.style.width = `${Math.floor(viewport.width)}px`;
      textLayerEl.style.height = `${Math.floor(viewport.height)}px`;
      const textLayer = new pdfjs.TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container: textLayerEl,
        viewport,
      });
      textLayerTaskRef.current = textLayer;
      await textLayer.render();

      paintHighlights(viewport, pageNum, highlightsRef.current);
    },
    [paintHighlights]
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
          if (gen !== loadGenRef.current) return;
          if (offlineMeta) {
            const ranged = await createOpfsPdfRangeTransport(pdfjs, materialId);
            if (gen !== loadGenRef.current) return;
            if (ranged) {
              loadingTask = pdfjs.getDocument({
                range: ranged.transport,
                length: ranged.length,
                disableAutoFetch: true,
                disableStream: true,
                rangeChunkSize: 512 * 1024,
              });
              setUsingOffline(true);
              setOfflineUi("offline_ready");
            } else if (
              offlineMeta.entitlementExpiresAt > 0 &&
              Date.now() > offlineMeta.entitlementExpiresAt
            ) {
              setOfflineUi("offline_expired");
              throw new Error(
                "Offline access expired — connect to update access."
              );
            } else if (!navigator.onLine) {
              setOfflineUi("offline_unavailable");
              throw new Error(
                "Connect to the internet to read this document."
              );
            }
          } else if (!navigator.onLine) {
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

          const contentLength = Number(
            probe.headers.get("content-length") ?? "0"
          );
          if (!Number.isFinite(contentLength) || contentLength <= 0) {
            throw new Error("Could not determine PDF size.");
          }

          // Explicit Range transport — do not use pdfjs url-mode. PDF.js
          // validateRangeRequestCapabilities() trusts Content-Length only; our
          // coerced leading 206 (CL=64KiB) disables ranges and yields
          // "Invalid PDF structure" on real documents.
          onlineLoadAbortRef.current?.abort();
          const onlineAc = new AbortController();
          onlineLoadAbortRef.current = onlineAc;
          const ranged = await createOnlinePdfRangeTransport(pdfjs, {
            materialId,
            length: contentLength,
            signal: onlineAc.signal,
          });
          if (gen !== loadGenRef.current) {
            onlineAc.abort();
            return;
          }
          loadingTask = pdfjs.getDocument({
            range: ranged.transport,
            length: ranged.length,
            disableAutoFetch: true,
            disableStream: true,
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
    void loadDocument({
      preferOffline: preferOfflineDefault || !navigator.onLine,
    });
    return () => {
      loadGenRef.current += 1;
      onlineLoadAbortRef.current?.abort();
      renderTaskRef.current?.cancel();
      loadingTaskRef.current?.destroy().catch(() => undefined);
      loadingTaskRef.current = null;
      textLayerTaskRef.current?.cancel();
      textLayerTaskRef.current = null;
      pdfRef.current?.destroy().catch(() => undefined);
      pdfRef.current = null;
      // Do NOT abort Save-for-Offline here — document reloads must not
      // cancel a multi-minute OPFS range save still in progress.
    };
    // Intentionally once per materialId — scale changes re-render below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId, preferOfflineDefault]);

  // Abort in-flight offline save only when leaving the reader entirely.
  useEffect(() => {
    return () => {
      offlineAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPdfHighlights(materialId);
        if (!cancelled) {
          setHighlights(rows);
          highlightsRef.current = rows;
        }
      } catch {
        /* table may be missing before mig; reader still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [materialId]);

  useEffect(() => {
    const onFs = () => {
      const node = containerRef.current;
      setIsFullscreen(Boolean(node && document.fullscreenElement === node));
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Re-paint overlays when highlights change without full page re-render.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || loading) return;
    paintHighlights(vp, page, highlights);
  }, [highlights, page, loading, paintHighlights]);

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
        setScale((s) => Math.min(MAX_SCALE, Number((s + SCALE_STEP).toFixed(2))));
      } else if (e.key === "-") {
        e.preventDefault();
        setScale((s) => Math.max(MIN_SCALE, Number((s - SCALE_STEP).toFixed(2))));
      } else if (e.key === "Escape" && document.fullscreenElement) {
        void document.exitFullscreen?.();
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
    if (document.fullscreenElement === node) {
      void document.exitFullscreen?.();
      return;
    }
    void node.requestFullscreen?.().catch(() => {
      toast.message(
        "Fullscreen is not available in this browser. Rotate the device or use zoom instead."
      );
    });
  };

  const exitFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
  };

  const touchDistance = (touches: ArrayLike<{ clientX: number; clientY: number }>) => {
    if (touches.length < 2) return 0;
    const a = touches[0];
    const b = touches[1];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };

  const onPinchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2) {
      pinchRef.current = null;
      return;
    }
    // Two-finger pinch: prevent page scroll while zooming.
    e.preventDefault();
    pinchRef.current = {
      startDistance: touchDistance(e.touches),
      startScale: scale,
    };
  };

  const onPinchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!pinchRef.current || e.touches.length !== 2) return;
    e.preventDefault();
    const dist = touchDistance(e.touches);
    if (pinchRef.current.startDistance < 8) return;
    const next = pinchRef.current.startScale * (dist / pinchRef.current.startDistance);
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(next.toFixed(2))));
    setScale(clamped);
  };

  const onPinchEnd = () => {
    pinchRef.current = null;
  };

  const captureSelectionForHighlight = () => {
    const viewport = viewportRef.current;
    const stage = pageStageRef.current;
    const textLayer = textLayerRef.current;
    if (!viewport || !stage || !textLayer) {
      setPendingHighlight(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPendingHighlight(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (
      !textLayer.contains(range.commonAncestorContainer) &&
      range.commonAncestorContainer !== textLayer
    ) {
      setPendingHighlight(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      setPendingHighlight(null);
      return;
    }
    const clientRects = range.getClientRects();
    const rects = clientRectsToPdfRects(viewport, stage, clientRects);
    if (rects.length === 0) {
      setPendingHighlight(null);
      return;
    }
    setPendingHighlight({ rects, text });
  };

  const savePendingHighlight = async () => {
    if (!pendingHighlight) return;
    try {
      const row = await createPdfHighlight({
        materialId,
        pageNumber: page,
        rects: pendingHighlight.rects,
        selectedText: pendingHighlight.text,
      });
      setHighlights((prev) => [...prev, row]);
      setPendingHighlight(null);
      window.getSelection()?.removeAllRanges();
      toast.success("Highlight saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save highlight.";
      toast.error(msg === "Empty highlight" ? "Select text first." : "Could not save highlight.");
    }
  };

  const onTextPointerUp = (_e: ReactPointerEvent<HTMLDivElement>) => {
    // Defer so the selection is finalized after the pointerup.
    window.setTimeout(() => captureSelectionForHighlight(), 0);
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
      const expires = Date.now() + ENTITLEMENT_TTL_MS;
      await markOfflineSavePending({
        materialId,
        title,
        byteSize: total,
        contentRevision: rev,
        entitlementExpiresAt: expires,
      });
      await savePdfForOffline({
        materialId,
        title,
        contentRevision: rev,
        entitlementExpiresAt: expires,
        signal: ac.signal,
        onProgress: ({ loaded, total: t }) => {
          setSavePct(formatPct(loaded, t > 0 ? t : total));
        },
      });
      setPendingSaveSize(null);
      setOfflineUi("offline_ready");
      await refreshOfflineUsage();
      requestCacheOfflineReader(materialId);
      toast.success("Saved for offline reading");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "offline_failed";
      if (msg === "offline_cancelled") {
        await removeOfflinePdf(materialId).catch(() => undefined);
        setOfflineUi("online_only");
        setPendingSaveSize(null);
        toast.message("Offline save cancelled");
        return;
      }
      if (msg === "study_object_denied") {
        await removeOfflinePdf(materialId).catch(() => undefined);
        setOfflineUi("online_only");
        setPendingSaveSize(null);
        toast.error("You do not have access to this PDF.");
        return;
      }
      await markOfflineSaveFailed(materialId).catch(() => undefined);
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
        return `Saving… ${savePct}`;
      case "offline_ready":
        return usingOffline
          ? "Available offline (reading cached copy)"
          : "Available offline";
      case "offline_expired":
        return "Offline access expired";
      case "offline_unavailable":
        return "Connect to the internet to read this document.";
      case "save_failed":
        return "Failed — Retry";
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
          Large files load by page range — first pages appear before the full
          file is transferred.
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
      className={
        isFullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-neutral-950"
          : "grid gap-2 rounded-xl border bg-card p-2 sm:gap-3 sm:p-3"
      }
      data-testid="pdf-viewer"
      data-fullscreen={isFullscreen ? "true" : "false"}
    >
      {isFullscreen ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="pdf-viewer-fs-close h-9 w-9 rounded-full shadow"
          onClick={exitFullscreen}
          aria-label="Exit fullscreen"
          data-testid="pdf-fullscreen-close"
        >
          ×
        </Button>
      ) : null}

      {!isFullscreen ? (
        <>
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
              Retry
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={fullscreen}
            data-testid="pdf-fullscreen"
          >
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
          onClick={() =>
            setScale((s) =>
              Math.max(MIN_SCALE, Number((s - SCALE_STEP).toFixed(2)))
            )
          }
        >
          Zoom −
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setScale((s) =>
              Math.min(MAX_SCALE, Number((s + SCALE_STEP).toFixed(2)))
            )
          }
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

      {pendingHighlight ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1.5">
          <span className="max-w-[min(100%,28rem)] truncate text-xs text-muted-foreground">
            Highlight: “{pendingHighlight.text.slice(0, 80)}
            {pendingHighlight.text.length > 80 ? "…" : ""}”
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => void savePendingHighlight()}
            data-testid="pdf-highlight-save"
          >
            Save highlight
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setPendingHighlight(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
        </>
      ) : null}

      <div
        className={
          isFullscreen
            ? "pdf-viewer-scroll relative min-h-0 flex-1 overflow-auto bg-neutral-900"
            : "pdf-viewer-scroll relative overflow-auto rounded border bg-neutral-100"
        }
        onTouchStart={onPinchStart}
        onTouchMove={onPinchMove}
        onTouchEnd={onPinchEnd}
        onTouchCancel={onPinchEnd}
      >
        <div
          ref={pageStageRef}
          className="pdf-page-stage"
          data-testid="pdf-page-stage"
        >
          <canvas ref={canvasRef} className="block" />
          <div
            ref={textLayerRef}
            className="textLayer"
            data-testid="pdf-text-layer"
            onPointerUp={onTextPointerUp}
          />
          <div
            ref={highlightLayerRef}
            className="pdf-highlight-layer"
            data-testid="pdf-highlight-layer"
          />
          {watermarkLine ? (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-3 z-[3] text-center text-[11px] font-medium tracking-wide text-black/25 select-none"
              aria-hidden
            >
              {watermarkLine}
            </div>
          ) : null}
        </div>
      </div>

      {!isFullscreen ? (
        <p className="text-[11px] text-muted-foreground">
          In-app reader only — no public file link. Select text to highlight
          (saved to your account). Pinch to zoom on touch devices. Offline
          copies stay inside MedVerse and expire when access ends.
        </p>
      ) : null}
    </div>
  );
}
