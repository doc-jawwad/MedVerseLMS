"use client";

import { memo, useEffect, useRef, useState, type RefObject } from "react";
import {
  pdfRectsToViewportBoxes,
  type PdfHighlightRow,
} from "@/lib/study/pdf-highlights";
import {
  placeholderSize,
  type PdfPageBaseSize,
} from "@/lib/study/pdf-scroll";

type PdfjsLib = typeof import("pdfjs-dist");
type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
type PdfPage = import("pdfjs-dist").PDFPageProxy;
export type PdfPageViewport = ReturnType<PdfPage["getViewport"]>;

/** Pages are rendered only near the scroll viewport; others are freed. */
const RENDER_ROOT_MARGIN = "100% 0px";

function PdfPageSlotImpl({
  doc,
  pdfjs,
  pageNumber,
  scale,
  base,
  highlights,
  watermarkLine,
  scrollRootRef,
  registerViewport,
  onRemoveHighlight,
}: {
  doc: PdfDocument;
  pdfjs: PdfjsLib;
  pageNumber: number;
  scale: number;
  /** Exact page size at scale 1 (pre-measured; not assumed equal to page 1). */
  base: PdfPageBaseSize;
  highlights: PdfHighlightRow[];
  watermarkLine?: string;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  registerViewport: (pageNumber: number, viewport: PdfPageViewport | null) => void;
  onRemoveHighlight: (id: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PdfPageViewport | null>(null);
  const onRemoveRef = useRef(onRemoveHighlight);
  useEffect(() => {
    onRemoveRef.current = onRemoveHighlight;
  }, [onRemoveHighlight]);

  const [visible, setVisible] = useState(false);
  const [paintTick, setPaintTick] = useState(0);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { root: scrollRootRef.current, rootMargin: RENDER_ROOT_MARGIN }
    );
    io.observe(stage);
    return () => io.disconnect();
  }, [scrollRootRef]);

  useEffect(() => {
    return () => {
      registerViewport(pageNumber, null);
    };
  }, [pageNumber, registerViewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayerEl = textLayerRef.current;
    const highlightLayer = highlightLayerRef.current;
    if (!canvas || !textLayerEl || !highlightLayer) return;

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let textTask: { cancel: () => void } | null = null;

    const free = () => {
      canvas.width = 0;
      canvas.height = 0;
      textLayerEl.replaceChildren();
      highlightLayer.replaceChildren();
      viewportRef.current = null;
      registerViewport(pageNumber, null);
    };

    if (!visible) {
      free();
      return () => {
        cancelled = true;
        renderTask?.cancel();
        textTask?.cancel();
      };
    }

    void (async () => {
      try {
        const pdfPage: PdfPage = await doc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        textLayerEl.replaceChildren();
        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        textLayerEl.style.width = `${Math.floor(viewport.width)}px`;
        textLayerEl.style.height = `${Math.floor(viewport.height)}px`;
        const textLayer = new pdfjs.TextLayer({
          textContentSource: pdfPage.streamTextContent(),
          container: textLayerEl,
          viewport,
        });
        textTask = textLayer;
        await textLayer.render();
        if (cancelled) return;

        viewportRef.current = viewport;
        registerViewport(pageNumber, viewport);
        setPaintTick((t) => t + 1);
      } catch {
        /* cancelled renders and transient page errors: slot stays blank */
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textTask?.cancel();
    };
  }, [doc, pdfjs, pageNumber, scale, visible, registerViewport]);

  useEffect(() => {
    const layer = highlightLayerRef.current;
    const viewport = viewportRef.current;
    if (!layer) return;
    layer.replaceChildren();
    if (!viewport) return;
    for (const row of highlights) {
      for (const box of pdfRectsToViewportBoxes(viewport, row.rects)) {
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
          onRemoveRef.current(row.id);
        });
        layer.appendChild(mark);
      }
    }
  }, [highlights, paintTick]);

  const size = placeholderSize(base, scale);

  return (
    <div
      ref={stageRef}
      className="pdf-page-stage"
      data-testid="pdf-page"
      data-page-number={pageNumber}
      style={{ width: size.width, height: size.height }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={textLayerRef}
        className="textLayer"
        data-testid="pdf-text-layer"
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
  );
}

export const PdfPageSlot = memo(PdfPageSlotImpl);
