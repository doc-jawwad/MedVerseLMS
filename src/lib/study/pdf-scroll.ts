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


/** Keep the same logical page and fractional position as estimated dimensions
 * become exact (or zoom changes). Preserve the small gap between pages. */
export function remapPdfScrollTop(
  oldTops: readonly number[],
  oldHeights: readonly number[],
  newTops: readonly number[],
  newHeights: readonly number[],
  scrollTop: number
): number {
  if (!oldTops.length || oldTops.length !== newTops.length) return scrollTop;
  const i = pageAtScrollTop(oldTops, scrollTop, 0) - 1;
  const offset = scrollTop - oldTops[i];
  const oldHeight = oldHeights[i];
  const newHeight = newHeights[i];
  if (!(oldHeight > 0) || !(newHeight > 0)) return scrollTop;
  const nextOffset = offset < 0 ? offset
    : offset > oldHeight ? newHeight + offset - oldHeight
    : offset * newHeight / oldHeight;
  return Math.max(0, newTops[i] + nextOffset);
}

type MeasureSubscriber = {
  resolve: (value: PdfPageBaseSize | undefined) => void;
  signal: AbortSignal;
  abort: () => void;
};
type MeasureJob = { page: number; running: boolean; subscribers: Set<MeasureSubscriber> };

/** Only measure pages requested near the viewport. Bound simultaneous work,
 * share in-flight reads, and discard queued work when a page leaves view. */
export function createPdfPageMeasureQueue(doc: PdfDocLike, concurrency = 4) {
  const jobs = new Map<number, MeasureJob>();
  const cache = new Map<number, PdfPageBaseSize>();
  let active = 0;
  const limit = Math.max(1, Math.floor(concurrency));

  function pump() {
    for (const job of jobs.values()) {
      if (active >= limit) break;
      if (job.running || !job.subscribers.size) continue;
      job.running = true;
      active++;
      void (async () => {
        let value: PdfPageBaseSize | undefined;
        try {
          const page = await doc.getPage(job.page);
          const { width, height } = page.getViewport({ scale: 1 });
          value = { width, height };
          cache.set(job.page, value);
        } catch {
          // A failed page remains a placeholder; revisiting can retry.
        } finally {
          jobs.delete(job.page);
          active--;
          for (const sub of job.subscribers) {
            sub.signal.removeEventListener("abort", sub.abort);
            sub.resolve(sub.signal.aborted ? undefined : value);
          }
          pump();
        }
      })();
    }
  }

  return (page: number, signal: AbortSignal): Promise<PdfPageBaseSize | undefined> => {
    if (signal.aborted || page < 1 || page > doc.numPages) return Promise.resolve(undefined);
    const cached = cache.get(page);
    if (cached) return Promise.resolve(cached);
    let job = jobs.get(page);
    if (!job) {
      job = { page, running: false, subscribers: new Set() };
      jobs.set(page, job);
    }
    const entry = job;
    return new Promise((resolve) => {
      const sub: MeasureSubscriber = { resolve, signal, abort: () => {
        entry.subscribers.delete(sub);
        signal.removeEventListener("abort", sub.abort);
        if (!entry.running && !entry.subscribers.size) jobs.delete(page);
        resolve(undefined);
      } };
      entry.subscribers.add(sub);
      signal.addEventListener("abort", sub.abort, { once: true });
      pump();
    });
  };
}
