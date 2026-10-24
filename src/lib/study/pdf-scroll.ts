/**
 * Continuous-scroll helpers for the PDF reader (pure, unit-tested).
 */

export type PdfPageBaseSize = { width: number; height: number };

/**
 * Same-origin relative fixture URLs only (blocks protocol-relative //… and absolute URLs).
 * Used by the optional dev `fixtureUrl` prop; production builds skip that path via NODE_ENV.
 */
export function isSafePdfFixtureUrl(
  url: string | undefined | null
): url is string {
  if (!url) return false;
  return url.startsWith("/") && !url.startsWith("//");
}

/**
 * Current page for a scroll position: the last page whose top edge is at or
 * above `scrollTop + anchor`. `tops` are page offsets (ascending), 0-based
 * index → 1-based page number.
 */
export function pageAtScrollTop(
  tops: ArrayLike<number>,
  scrollTop: number,
  anchor: number
): number {
  const n = tops.length;
  if (n === 0) return 1;
  const y = scrollTop + anchor;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Keep the reader's place when zoom changes (all page heights scale together). */
export function scrollTopAfterZoom(
  scrollTop: number,
  prevScale: number,
  nextScale: number
): number {
  if (!(prevScale > 0) || !(nextScale > 0)) return scrollTop;
  return Math.max(0, scrollTop * (nextScale / prevScale));
}

/** Placeholder size for a page that is not (or no longer) rendered. */
export function placeholderSize(
  baseAtScale1: PdfPageBaseSize,
  scale: number
): PdfPageBaseSize {
  return {
    width: Math.floor(baseAtScale1.width * scale),
    height: Math.floor(baseAtScale1.height * scale),
  };
}

type PdfPageLike = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
};

type PdfDocLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
};

/**
 * Read each page's MediaBox-backed viewport at scale 1 so continuous-scroll
 * placeholders match real page sizes before any canvas is painted.
 * Concurrency is capped so large docs do not stampede the worker.
 */
export async function measurePageBases(
  doc: PdfDocLike,
  concurrency = 8
): Promise<PdfPageBaseSize[]> {
  const n = doc.numPages;
  const out: PdfPageBaseSize[] = new Array(n);
  if (n <= 0) return out;
  const limit = Math.max(1, Math.min(concurrency, n));
  let next = 1;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = next++;
        if (i > n) return;
        const page = await doc.getPage(i);
        const unit = page.getViewport({ scale: 1 });
        out[i - 1] = { width: unit.width, height: unit.height };
      }
    })
  );
  return out;
}
