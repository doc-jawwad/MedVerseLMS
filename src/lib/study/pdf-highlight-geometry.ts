export type PdfHighlightRect = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PdfViewportLike = {
  width: number;
  height: number;
  convertToPdfPoint: (x: number, y: number) => number[];
  convertToViewportRectangle: (rect: number[]) => number[];
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function normalizeHighlightRects(raw: unknown): PdfHighlightRect[] {
  if (!Array.isArray(raw)) return [];
  const out: PdfHighlightRect[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const x1 = Number(r.x1);
    const y1 = Number(r.y1);
    const x2 = Number(r.x2);
    const y2 = Number(r.y2);
    if (
      !isFiniteNumber(x1) ||
      !isFiniteNumber(y1) ||
      !isFiniteNumber(x2) ||
      !isFiniteNumber(y2)
    ) {
      continue;
    }
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}

/** Map DOM client rects (over the page wrapper) into PDF user-space rects. */
export function clientRectsToPdfRects(
  viewport: PdfViewportLike,
  pageEl: HTMLElement,
  clientRects: ArrayLike<DOMRectReadOnly>
): PdfHighlightRect[] {
  const pageBox = pageEl.getBoundingClientRect();
  if (pageBox.width <= 0 || pageBox.height <= 0) return [];
  const sx = viewport.width / pageBox.width;
  const sy = viewport.height / pageBox.height;
  const out: PdfHighlightRect[] = [];

  for (let i = 0; i < clientRects.length; i++) {
    const r = clientRects[i];
    if (!r || r.width < 1 || r.height < 1) continue;
    const vx1 = (r.left - pageBox.left) * sx;
    const vy1 = (r.top - pageBox.top) * sy;
    const vx2 = (r.right - pageBox.left) * sx;
    const vy2 = (r.bottom - pageBox.top) * sy;
    const [x1, y1] = viewport.convertToPdfPoint(vx1, vy1);
    const [x2, y2] = viewport.convertToPdfPoint(vx2, vy2);
    if (
      !isFiniteNumber(x1) ||
      !isFiniteNumber(y1) ||
      !isFiniteNumber(x2) ||
      !isFiniteNumber(y2)
    ) {
      continue;
    }
    out.push({ x1, y1, x2, y2 });
  }
  return mergeNearbyRects(out);
}

/** Convert stored PDF-space rects into CSS overlay boxes for the current viewport. */
export function pdfRectsToViewportBoxes(
  viewport: PdfViewportLike,
  rects: PdfHighlightRect[]
): ViewportRect[] {
  const boxes: ViewportRect[] = [];
  for (const r of rects) {
    const [a, b, c, d] = viewport.convertToViewportRectangle([
      r.x1,
      r.y1,
      r.x2,
      r.y2,
    ]);
    const left = Math.min(a, c);
    const top = Math.min(b, d);
    const width = Math.abs(c - a);
    const height = Math.abs(d - b);
    if (width < 0.5 || height < 0.5) continue;
    boxes.push({ left, top, width, height });
  }
  return boxes;
}

/** Collapse tiny fragmented selection rects that share a line. */
export function mergeNearbyRects(rects: PdfHighlightRect[]): PdfHighlightRect[] {
  if (rects.length <= 1) return rects;
  const sorted = [...rects].sort((a, b) => {
    const ay = Math.min(a.y1, a.y2);
    const by = Math.min(b.y1, b.y2);
    if (Math.abs(ay - by) > 0.5) return by - ay;
    return Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2);
  });
  const merged: PdfHighlightRect[] = [];
  for (const r of sorted) {
    const cur = {
      x1: Math.min(r.x1, r.x2),
      y1: Math.min(r.y1, r.y2),
      x2: Math.max(r.x1, r.x2),
      y2: Math.max(r.y1, r.y2),
    };
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.abs(prev.y1 - cur.y1) < 1.5 &&
      Math.abs(prev.y2 - cur.y2) < 1.5 &&
      cur.x1 <= prev.x2 + 2
    ) {
      prev.x2 = Math.max(prev.x2, cur.x2);
      prev.y1 = Math.min(prev.y1, cur.y1);
      prev.y2 = Math.max(prev.y2, cur.y2);
    } else {
      merged.push(cur);
    }
  }
  return merged;
}
