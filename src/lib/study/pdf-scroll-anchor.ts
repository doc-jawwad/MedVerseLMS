/** Logical reading position, independent of provisional page dimensions. */
export type PdfPageGeometry = { top: number; height: number };
export type PdfScrollAnchor = {
  pageNumber: number;
  position: "before" | "inside" | "after";
  offset: number;
};

/** Geometry must be ordered by page and expressed in scroll-content pixels.
 * Capture immediately before a geometry/zoom update, not when a fetch starts.
 * Inside a page, offset is a fraction; outside it, offset is pixels from its edge.
 */
export function capturePdfScrollAnchor(
  pages: readonly PdfPageGeometry[],
  scrollTop: number,
  viewportAnchor: number
): PdfScrollAnchor | null {
  if (!pages.length) return null;
  const y = scrollTop + viewportAnchor;
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (pages[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  const { top, height } = pages[lo];
  const pageNumber = lo + 1;
  if (y < top) return { pageNumber, position: "before", offset: y - top };
  if (height > 0 && y <= top + height) {
    return { pageNumber, position: "inside", offset: (y - top) / height };
  }
  return { pageNumber, position: "after", offset: y - top - height };
}

/** Resolve the same logical point against the newly committed geometry.
 * Return null for missing pages; the caller must not restore a stale document.
 */
export function restorePdfScrollAnchor(
  pages: readonly PdfPageGeometry[],
  anchor: PdfScrollAnchor,
  viewportAnchor: number,
  maxScrollTop: number
): number | null {
  const page = pages[anchor.pageNumber - 1];
  if (!page) return null;
  let y = page.top;
  if (anchor.position === "inside") {
    y += page.height * anchor.offset;
  } else if (anchor.position === "before") {
    y += anchor.offset;
  } else {
    const end = page.top + page.height;
    const next = pages[anchor.pageNumber];
    const gap = next ? Math.max(0, next.top - end) : Infinity;
    y = end + Math.min(anchor.offset, gap);
  }
  return Math.min(Math.max(0, maxScrollTop), Math.max(0, y - viewportAnchor));
}
