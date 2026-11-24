import type { PDFDocumentProxy } from "pdfjs-dist";

export type PdfOutlineItem = { title: string; pageNumber: number };

/** Resolve optional navigation metadata without holding up the reader.
 * A superseded document must never publish its outline to the current viewer.
 */
export async function readPdfOutline(
  doc: Pick<PDFDocumentProxy, "getOutline" | "getDestination" | "getPageIndex">,
  isCurrent: () => boolean
): Promise<PdfOutlineItem[] | null> {
  if (!isCurrent()) return null;
  try {
    const raw = await doc.getOutline();
    if (!isCurrent()) return null;
    const items: PdfOutlineItem[] = [];
    for (const node of (raw ?? []).slice(0, 80)) {
      if (!isCurrent()) return null;
      try {
        const dest = node.dest;
        let pageIndex = 0;
        if (typeof dest === "string") {
          const d = await doc.getDestination(dest);
          if (!isCurrent()) return null;
          if (d) pageIndex = await doc.getPageIndex(d[0]);
        } else if (Array.isArray(dest) && dest[0]) {
          pageIndex = await doc.getPageIndex(dest[0]);
        }
        if (!isCurrent()) return null;
        items.push({ title: String(node.title ?? "Section"), pageNumber: pageIndex + 1 });
      } catch {
        /* skip bad outline nodes */
      }
    }
    return isCurrent() ? items : null;
  } catch {
    return isCurrent() ? [] : null;
  }
}
