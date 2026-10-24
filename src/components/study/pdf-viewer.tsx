"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { canUseOrientationLock } from "@/lib/pwa/prefer-portrait";
import {
  clientRectsToPdfRects,
  createPdfHighlight,
  deletePdfHighlight,
  listPdfHighlights,
  type PdfHighlightRow,
} from "@/lib/study/pdf-highlights";
import { clampPage } from "@/lib/study/pdf-page-clamp";
import {
  createDebouncedPageSaver,
  loadPdfReadingPage,
} from "@/lib/study/pdf-reading-progress";
import { fitWidthScale } from "@/lib/study/pdf-fit-width";
import {
  CHROME_IDLE_MS,
  MAX_SCALE,
  MIN_SCALE,
  PROGRESS_SAVE_MS,
  SCALE_STEP,
} from "@/lib/study/pdf-viewer-constants";
import {
  isSafePdfFixtureUrl,
  measurePageBases,
  pageAtScrollTop,
  scrollTopAfterZoom,
  type PdfPageBaseSize,
} from "@/lib/study/pdf-scroll";
import { PdfPageSlot, type PdfPageViewport } from "./pdf-page-slot";
import "@/styles/pdf-text-layer.css";

type PdfjsLib = typeof import("pdfjs-dist");
type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;

const NO_HIGHLIGHTS: PdfHighlightRow[] = [];
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

export function PdfViewer({
  materialId,
  title,
  watermarkName,
  watermarkCollege,
  preferOfflineDefault = false,
  fixtureUrl,
}: {
  materialId: string;
  title: string;
  watermarkName?: string;
  watermarkCollege?: string;
  /** When true (Offline Library reader), prefer OPFS ranges even while online. */
  preferOfflineDefault?: boolean;
  /**
   * Dev/harness only: same-origin URL loaded via pdf.js (skips R2/study-content).
   * Ignored when `NODE_ENV === "production"` (dead-code eliminated in prod builds).
   */
  fixtureUrl?: string;
}) {
  const columnRef = useRef<HTMLDivElement>(null);
  const viewportsRef = useRef(new Map<number, PdfPageViewport>());
  const prevScaleRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const pdfjsRef = useRef<PdfjsLib | null>(null);
  const offlineAbortRef = useRef<AbortController | null>(null);
  const onlineLoadAbortRef = useRef<AbortController | null>(null);
  const loadGenRef = useRef(0);
  const loadingTaskRef = useRef<{ destroy: () => Promise<unknown> } | null>(
    null
  );
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
    liveScale: number;
  } | null>(null);
  const chromeIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSaverRef = useRef<ReturnType<typeof createDebouncedPageSaver> | null>(
    null
  );
  const fittedOnceRef = useRef(false);
  /** Page to scroll into view once the page column has mounted/updated. */
  const pendingScrollPageRef = useRef<number | null>(null);

  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [pdfjs, setPdfjs] = useState<PdfjsLib | null>(null);
  const [baseSize, setBaseSize] = useState<PdfPageBaseSize>({
    width: 612,
    height: 792,
  });
  /** Per-page size at scale 1 — never assume every page matches page 1. */
  const [pageBases, setPageBases] = useState<PdfPageBaseSize[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [outline, setOutline] = useState<
    Array<{ title: string; pageNumber: number }>
  >([]);
  const [showOutline, setShowOutline] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [offlineUi, setOfflineUi] = useState<OfflineUi>("checking");
  const [savePct, setSavePct] = useState("");
  const [pendingSaveSize, setPendingSaveSize] = useState<number | null>(null);
  const [offlineUsageLabel, setOfflineUsageLabel] = useState("");
  const [usingOffline, setUsingOffline] = useState(false);
  const [highlights, setHighlights] = useState<PdfHighlightRow[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [orientationLockSupported, setOrientationLockSupported] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<{
    pageNumber: number;
    rects: ReturnType<typeof clientRectsToPdfRects>;
    text: string;
  } | null>(null);

  const highlightsByPage = useMemo(() => {
    const m = new Map<number, PdfHighlightRow[]>();
    for (const h of highlights) {
      const list = m.get(h.page_number);
      if (list) list.push(h);
      else m.set(h.page_number, [h]);
    }
    return m;
  }, [highlights]);

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

  const registerViewport = useCallback(
    (pageNumber: number, viewport: PdfPageViewport | null) => {
      if (viewport) viewportsRef.current.set(pageNumber, viewport);
      else viewportsRef.current.delete(pageNumber);
    },
    []
  );

  const removeHighlight = useCallback(async (id: string) => {
    try {
      await deletePdfHighlight(id);
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      toast.message("Highlight removed");
    } catch {
      toast.error("Could not remove highlight.");
    }
  }, []);

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
        setPdfjs(pdfjs);
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        let loadingTask: {
          promise: Promise<PdfDocument>;
          destroy: () => Promise<unknown>;
        } | null = null;
        let offlineMeta: OfflinePdfMeta | null = null;

        // Isolated local harness: load a same-origin fixture without R2/auth.
        // Production builds inline NODE_ENV === "production", so this branch is removed.
        const useFixture =
          process.env.NODE_ENV !== "production" &&
          isSafePdfFixtureUrl(fixtureUrl);
        if (useFixture) {
          loadingTask = pdfjs.getDocument({ url: fixtureUrl });
          setOfflineUi("online_only");
        }

        if (!loadingTask && (opts.preferOffline || !navigator.onLine)) {
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
        viewportsRef.current.clear();
        setPageCount(doc.numPages);
        const saved = await loadPdfReadingPage(materialId);
        if (gen !== loadGenRef.current) return;
        const startPage = clampPage(saved ?? 1, doc.numPages);

        // Measure every page before mounting the column so mixed page sizes
        // do not shift scroll position / resume targets when canvases paint.
        const bases = await measurePageBases(doc);
        if (gen !== loadGenRef.current) {
          doc.destroy().catch(() => undefined);
          return;
        }
        setPageBases(bases);

        let nextScale = scale;
        try {
          const base =
            bases[startPage - 1] ??
            (await doc.getPage(startPage).then((p) => {
              const v = p.getViewport({ scale: 1 });
              return { width: v.width, height: v.height };
            }));
          const scrollEl = scrollRef.current ?? containerRef.current;
          const width = scrollEl?.clientWidth ?? window.innerWidth;
          nextScale = fitWidthScale(width, base.width, 8);
          setBaseSize(base);
          prevScaleRef.current = nextScale;
          setScale(nextScale);
          fittedOnceRef.current = true;
        } catch {
          /* keep current scale */
        }

        setPage(startPage);
        setDoc(doc);
        pendingScrollPageRef.current = startPage;

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
    [fixtureUrl, materialId, refreshOfflineUsage, scale, sourceUrl]
  );

  useEffect(() => {
    void loadDocument({
      preferOffline: preferOfflineDefault || !navigator.onLine,
    });
    return () => {
      loadGenRef.current += 1;
      onlineLoadAbortRef.current?.abort();
      loadingTaskRef.current?.destroy().catch(() => undefined);
      loadingTaskRef.current = null;
      pdfRef.current?.destroy().catch(() => undefined);
      pdfRef.current = null;
      // Do NOT abort Save-for-Offline here — document reloads must not
      // cancel a multi-minute OPFS range save still in progress.
    };
    // Intentionally once per materialId — scale changes re-render below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId, preferOfflineDefault, fixtureUrl]);

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
        if (!cancelled) setHighlights(rows);
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

  useEffect(() => {
    pageSaverRef.current = createDebouncedPageSaver(materialId, PROGRESS_SAVE_MS);
    fittedOnceRef.current = false;
    return () => {
      pageSaverRef.current?.flush();
      pageSaverRef.current?.cancel();
      pageSaverRef.current = null;
    };
  }, [materialId]);

  useEffect(() => {
    setOrientationLockSupported(canUseOrientationLock());
  }, []);

  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeIdleRef.current) clearTimeout(chromeIdleRef.current);
    chromeIdleRef.current = setTimeout(() => {
      setChromeVisible(false);
      setShowMore(false);
    }, CHROME_IDLE_MS);
  }, []);

  useEffect(() => {
    bumpChrome();
    return () => {
      if (chromeIdleRef.current) clearTimeout(chromeIdleRef.current);
    };
  }, [bumpChrome, page, isFullscreen]);

  const fitToWidth = useCallback(async () => {
    const doc = pdfRef.current;
    if (!doc) return;
    try {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const scrollEl = scrollRef.current ?? containerRef.current;
      const width = scrollEl?.clientWidth ?? window.innerWidth;
      setScale(fitWidthScale(width, base.width, 8));
      bumpChrome();
    } catch {
      /* ignore */
    }
  }, [bumpChrome, page]);

  const toggleOrientationLock = useCallback(async () => {
    if (!canUseOrientationLock()) return;
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock: (orientation: string) => Promise<void>;
      };
      const type = orientation.type;
      if (type.startsWith("landscape")) {
        await orientation.lock("portrait");
      } else {
        await orientation.lock("landscape");
      }
      bumpChrome();
    } catch {
      toast.message("Orientation lock is not available on this device.");
    }
  }, [bumpChrome]);

  const pageTops = useCallback((): number[] => {
    const col = columnRef.current;
    if (!col) return [];
    return Array.from(
      col.children,
      (el) => col.offsetTop + (el as HTMLElement).offsetTop
    );
  }, []);

  const scrollToPage = useCallback((n: number) => {
    const col = columnRef.current;
    const scroller = scrollRef.current;
    const el = col?.children[n - 1] as HTMLElement | undefined;
    if (!col || !scroller || !el) return;
    scroller.scrollTop = Math.max(0, col.offsetTop + el.offsetTop - 4);
  }, []);

  // Continuous scroll: derive the current page from the scroll position.
  const scrollRafRef = useRef<number | null>(null);
  const onReaderScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const scroller = scrollRef.current;
      if (!scroller || pageCount <= 0) return;
      const atEnd =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const next = atEnd
        ? pageCount
        : pageAtScrollTop(pageTops(), scroller.scrollTop, scroller.clientHeight * 0.35);
      setPage((p) => (p === next ? p : next));
    });
  }, [pageCount, pageTops]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // First mount of the page column: jump to the resume page.
  useLayoutEffect(() => {
    if (loading || !doc) return;
    const target = pendingScrollPageRef.current;
    if (target == null) return;
    pendingScrollPageRef.current = null;
    scrollToPage(target);
  }, [loading, doc, scrollToPage]);

  const clearPinchPreview = useCallback(() => {
    const col = columnRef.current;
    if (!col) return;
    col.style.transform = "";
    col.classList.remove("is-pinch-preview");
  }, []);

  // Zoom keeps the reader's place (all page heights scale together).
  // Also drop any CSS pinch preview once the committed scale is applied.
  useLayoutEffect(() => {
    const prev = prevScaleRef.current;
    const scroller = scrollRef.current;
    if (scroller && prev != null && prev !== scale) {
      scroller.scrollTop = scrollTopAfterZoom(scroller.scrollTop, prev, scale);
    }
    prevScaleRef.current = scale;
    clearPinchPreview();
  }, [scale, clearPinchPreview]);

  useEffect(() => {
    if (loading || !doc) return;
    pageSaverRef.current?.save(page);
  }, [page, loading, doc, materialId]);

  const goPage = useCallback(
    (n: number) => {
      if (pageCount <= 0) return;
      const target = clampPage(n, pageCount);
      setPage(target);
      scrollToPage(target);
      bumpChrome();
    },
    [bumpChrome, pageCount, scrollToPage]
  );

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
  }, [loading, error, page, pageCount, goPage]);

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
        goPage(i);
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
        goPage(i);
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
      if (pinchRef.current) {
        const live = pinchRef.current.liveScale;
        const start = pinchRef.current.startScale;
        pinchRef.current = null;
        scrollRef.current?.classList.remove("pinching");
        if (live !== start) setScale(live);
        else clearPinchPreview();
      } else {
        scrollRef.current?.classList.remove("pinching");
        clearPinchPreview();
      }
      return;
    }
    // Two-finger pinch: prevent page scroll while zooming.
    e.preventDefault();
    scrollRef.current?.classList.add("pinching");
    pinchRef.current = {
      startDistance: touchDistance(e.touches),
      startScale: scale,
      liveScale: scale,
    };
  };

  const onPinchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!pinchRef.current || e.touches.length !== 2) return;
    e.preventDefault();
    const dist = touchDistance(e.touches);
    if (pinchRef.current.startDistance < 8) return;
    const next =
      pinchRef.current.startScale * (dist / pinchRef.current.startDistance);
    const clamped = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Number(next.toFixed(2)))
    );
    // Visual-only preview during the gesture — commit scale once on end so
    // visible pages are not re-decoded on every touchmove.
    pinchRef.current.liveScale = clamped;
    const col = columnRef.current;
    if (col) {
      const ratio = clamped / pinchRef.current.startScale;
      col.classList.add("is-pinch-preview");
      col.style.transform = `scale(${ratio})`;
    }
  };

  const onPinchEnd = () => {
    const pinch = pinchRef.current;
    pinchRef.current = null;
    scrollRef.current?.classList.remove("pinching");
    if (!pinch) {
      clearPinchPreview();
      return;
    }
    if (pinch.liveScale !== pinch.startScale) {
      // useLayoutEffect clears the CSS preview after the real scale commits.
      setScale(pinch.liveScale);
    } else {
      clearPinchPreview();
    }
  };

  const onStagePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only toggle chrome for taps on the document stage (not chrome overlays).
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.("[data-testid='pdf-page-stage']")) return;
    // Ignore taps that end a text selection (highlight flow handles those).
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (target.closest?.(".pdf-highlight-mark")) return;
    setChromeVisible((v) => !v);
    if (chromeIdleRef.current) clearTimeout(chromeIdleRef.current);
    if (!chromeVisible) {
      chromeIdleRef.current = setTimeout(() => {
        setChromeVisible(false);
        setShowMore(false);
      }, CHROME_IDLE_MS);
    }
  };

  const captureSelectionForHighlight = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPendingHighlight(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    // Selections must sit inside one page's text layer (not span pages).
    const stage = el?.closest<HTMLElement>("[data-testid='pdf-page']");
    if (!stage || !el?.closest(".textLayer")) {
      setPendingHighlight(null);
      return;
    }
    const pageNumber = Number(stage.dataset.pageNumber);
    const viewport = viewportsRef.current.get(pageNumber);
    if (!viewport) {
      setPendingHighlight(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      setPendingHighlight(null);
      return;
    }
    const rects = clientRectsToPdfRects(viewport, stage, range.getClientRects());
    if (rects.length === 0) {
      setPendingHighlight(null);
      return;
    }
    setPendingHighlight({ pageNumber, rects, text });
  };

  const savePendingHighlight = async () => {
    if (!pendingHighlight) return;
    try {
      const row = await createPdfHighlight({
        materialId,
        pageNumber: pendingHighlight.pageNumber,
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

  const onColumnPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement | null)?.closest?.(".textLayer")) return;
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
          ? "pdf-viewer-root pdf-viewer-root--fs fixed inset-0 z-50 flex flex-col bg-neutral-950"
          : "pdf-viewer-root relative flex flex-col overflow-hidden rounded-xl border bg-card"
      }
      data-testid="pdf-viewer"
      data-fullscreen={isFullscreen ? "true" : "false"}
      data-chrome={chromeVisible ? "visible" : "hidden"}
    >
      <div
        ref={scrollRef}
        className={
          isFullscreen
            ? "pdf-viewer-scroll relative min-h-0 flex-1 overflow-auto bg-neutral-900"
            : "pdf-viewer-scroll relative min-h-0 flex-1 overflow-auto bg-neutral-100"
        }
        onTouchStart={onPinchStart}
        onTouchMove={onPinchMove}
        onTouchEnd={onPinchEnd}
        onTouchCancel={onPinchEnd}
        onPointerUp={onStagePointerUp}
        onScroll={onReaderScroll}
      >
        <div
          ref={columnRef}
          className="pdf-page-column"
          data-testid="pdf-page-stage"
          onPointerUp={onColumnPointerUp}
        >
          {doc && pdfjs
            ? Array.from({ length: pageCount }, (_, i) => (
                <PdfPageSlot
                  key={i + 1}
                  doc={doc}
                  pdfjs={pdfjs}
                  pageNumber={i + 1}
                  scale={scale}
                  base={pageBases[i] ?? baseSize}
                  highlights={highlightsByPage.get(i + 1) ?? NO_HIGHLIGHTS}
                  watermarkLine={watermarkLine}
                  scrollRootRef={scrollRef}
                  registerViewport={registerViewport}
                  onRemoveHighlight={(id) => void removeHighlight(id)}
                />
              ))
            : null}
        </div>
      </div>

      {/* Compact overlay chrome — auto-hides while reading */}
      <div
        className={
          chromeVisible
            ? "pdf-viewer-chrome absolute inset-x-0 top-0 z-20 opacity-100 transition-opacity"
            : "pdf-viewer-chrome pointer-events-none absolute inset-x-0 top-0 z-20 opacity-0 transition-opacity"
        }
        aria-hidden={!chromeVisible}
      >
        <div
          className={
            chromeVisible
              ? "pointer-events-auto flex items-center gap-1 bg-neutral-950/75 px-2 py-1.5 text-white backdrop-blur-sm pdf-safe-top"
              : "pointer-events-none flex items-center gap-1 bg-neutral-950/75 px-2 py-1.5 text-white backdrop-blur-sm pdf-safe-top"
          }
        >          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 min-w-9 px-2 text-white hover:bg-white/15 hover:text-white"
            disabled={page <= 1}
            onClick={() => goPage(page - 1)}
            aria-label="Previous page"
            data-testid="pdf-prev"
          >
            ‹
          </Button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              bumpChrome();
              onJump(e);
            }}
          >
            <Input
              name="page"
              type="number"
              min={1}
              max={pageCount || 1}
              defaultValue={page}
              key={page}
              className="h-8 w-12 border-white/20 bg-white/10 text-center text-white sm:w-14"
              aria-label="Page number"
              data-testid="pdf-page-input"
              onFocus={bumpChrome}
            />
            <span className="text-xs text-white/80" data-testid="pdf-page-indicator">
              / {pageCount}
            </span>
          </form>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 min-w-9 px-2 text-white hover:bg-white/15 hover:text-white"
            disabled={page >= pageCount}
            onClick={() => goPage(page + 1)}
            aria-label="Next page"
            data-testid="pdf-next"
          >
            ›
          </Button>
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 px-2 text-xs text-white hover:bg-white/15 hover:text-white"
              onClick={() => {
                setScale((s) =>
                  Math.max(MIN_SCALE, Number((s - SCALE_STEP).toFixed(2)))
                );
                bumpChrome();
              }}
              aria-label="Zoom out"
              data-testid="pdf-zoom-out"
            >
              −
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 px-2 text-xs text-white hover:bg-white/15 hover:text-white"
              onClick={() => void fitToWidth()}
              aria-label="Fit width"
              data-testid="pdf-fit-width"
            >
              Fit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 px-2 text-xs text-white hover:bg-white/15 hover:text-white"
              onClick={() => {
                setScale((s) =>
                  Math.min(MAX_SCALE, Number((s + SCALE_STEP).toFixed(2)))
                );
                bumpChrome();
              }}
              aria-label="Zoom in"
              data-testid="pdf-zoom-in"
            >
              +
            </Button>
            <span className="hidden text-[10px] text-white/70 sm:inline">
              {Math.round(scale * 100)}%
            </span>
            {orientationLockSupported ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 px-2 text-xs text-white hover:bg-white/15 hover:text-white"
                onClick={() => void toggleOrientationLock()}
                aria-label="Toggle orientation lock"
                data-testid="pdf-orientation"
              >
                Rotate
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 px-2 text-xs text-white hover:bg-white/15 hover:text-white"
              onClick={() => {
                setShowMore((v) => !v);
                bumpChrome();
              }}
              aria-label="More controls"
              data-testid="pdf-more"
            >
              More
            </Button>
            {isFullscreen ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 px-2 text-white hover:bg-white/15 hover:text-white"
                onClick={exitFullscreen}
                aria-label="Exit fullscreen"
                data-testid="pdf-fullscreen-close"
              >
                Exit
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 px-2 text-xs text-white hover:bg-white/15 hover:text-white"
                onClick={() => {
                  fullscreen();
                  bumpChrome();
                }}
                data-testid="pdf-fullscreen"
              >
                Full
              </Button>
            )}
          </div>
        </div>

        {showMore && chromeVisible ? (
          <div className="pointer-events-auto max-h-[40vh] overflow-auto border-t border-white/10 bg-neutral-950/90 px-2 py-2 text-white backdrop-blur-sm">
            <p className="mb-2 text-[11px] text-white/70" data-testid="pdf-offline-status">
              {offlineLabel}
              {offlineUsageLabel ? ` · ${offlineUsageLabel}` : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {offlineUi === "saving" ? (
                <Button type="button" size="sm" variant="secondary" onClick={cancelOfflineSave}>
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
                    className="text-white"
                    onClick={() => setPendingSaveSize(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : offlineUi === "save_failed" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void startOfflineSave()}
                  data-testid="pdf-offline-retry"
                >
                  Retry
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
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
                      variant="secondary"
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
                    className="text-white"
                    onClick={() => void clearOffline()}
                  >
                    Remove offline
                  </Button>
                </>
              )}
              {outline.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowOutline((v) => !v)}
                >
                  Outline
                </Button>
              )}
            </div>
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                bumpChrome();
                void onSearch(e);
              }}
            >
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in document"
                className="h-8 max-w-xs border-white/20 bg-white/10 text-white"
              />
              <Button type="submit" size="sm" variant="secondary">
                Search
              </Button>
              {searchStatus ? (
                <span className="text-xs text-white/70">{searchStatus}</span>
              ) : null}
            </form>
            {showOutline && outline.length > 0 && (
              <div className="mt-2 max-h-32 overflow-auto rounded border border-white/10 bg-black/30 p-2 text-sm">
                {outline.map((item, idx) => (
                  <button
                    key={`${item.pageNumber}-${idx}`}
                    type="button"
                    className="block w-full truncate px-1 py-0.5 text-left hover:bg-white/10"
                    onClick={() => goPage(item.pageNumber)}
                  >
                    {item.title}{" "}
                    <span className="text-white/50">p.{item.pageNumber}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {pendingHighlight ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-2 bg-neutral-950/85 px-3 py-2 text-white backdrop-blur-sm pdf-safe-bottom">
          <span className="min-w-0 flex-1 truncate text-xs text-white/80">
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
            className="text-white"
            onClick={() => {
              setPendingHighlight(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
