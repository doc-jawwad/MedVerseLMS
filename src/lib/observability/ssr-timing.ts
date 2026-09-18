/**
 * Isolated load-test SSR span timings. Off unless LOADTEST_SSR_TIMING=1
 * and MEDVERSE_ENV=loadtest. Do not enable on production/staging.
 */

export const SSR_TIMING_LOG_TAG = "ssr_timing";

export function ssrTimingEnabled(): boolean {
  return (
    process.env.LOADTEST_SSR_TIMING === "1" &&
    process.env.MEDVERSE_ENV === "loadtest"
  );
}

export function sanitizeSsrTimingToken(
  value: string | null | undefined,
  fallback = "none"
): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._:/-]/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export type SsrTimingSpan = {
  name: string;
  start_ms: number;
  ms: number;
};

export type SsrTimingStore = {
  t0: number;
  route: string;
  req: string;
  run: string;
  spans: SsrTimingSpan[];
  pageFnEndMs: number | null;
  flushed: boolean;
};

export function createSsrTimingStore(
  init: Partial<Pick<SsrTimingStore, "route" | "req" | "run">> = {}
): SsrTimingStore {
  return {
    t0: performance.now(),
    route: sanitizeSsrTimingToken(init.route, "unknown"),
    req: sanitizeSsrTimingToken(init.req),
    run: sanitizeSsrTimingToken(init.run),
    spans: [],
    pageFnEndMs: null,
    flushed: false,
  };
}

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function pushSpan(store: SsrTimingStore, name: string, start: number): void {
  store.spans.push({
    name: sanitizeSsrTimingToken(name, "span"),
    start_ms: roundMs(start - store.t0),
    ms: roundMs(performance.now() - start),
  });
}

export function runSsrSpanSync<T>(
  store: SsrTimingStore | null,
  name: string,
  fn: () => T
): T {
  if (!store) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    pushSpan(store, name, start);
  }
}

export async function runSsrSpan<T>(
  store: SsrTimingStore | null,
  name: string,
  fn: () => PromiseLike<T>
): Promise<T> {
  if (!store) return await fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    pushSpan(store, name, start);
  }
}

export function markSsrPageFnEnd(store: SsrTimingStore | null): void {
  if (!store || store.pageFnEndMs != null) return;
  store.pageFnEndMs = roundMs(performance.now() - store.t0);
}

export type SsrTimingPayload = {
  tag: typeof SSR_TIMING_LOG_TAG;
  layer: string;
  route: string;
  req: string;
  run: string;
  total_ms: number;
  page_fn_ms: number | null;
  html_ms: number | null;
  spans: SsrTimingSpan[];
};

export function buildSsrTimingPayload(
  store: SsrTimingStore,
  layer: string
): SsrTimingPayload {
  const totalMs = roundMs(performance.now() - store.t0);
  const pageFnMs = store.pageFnEndMs;
  return {
    tag: SSR_TIMING_LOG_TAG,
    layer: sanitizeSsrTimingToken(layer, "unknown"),
    route: store.route,
    req: store.req,
    run: store.run,
    total_ms: totalMs,
    page_fn_ms: pageFnMs,
    html_ms: pageFnMs == null ? null : roundMs(totalMs - pageFnMs),
    spans: store.spans,
  };
}

export function formatSsrTimingLog(
  store: SsrTimingStore,
  layer: string
): string {
  return JSON.stringify(buildSsrTimingPayload(store, layer));
}

export function flushSsrTiming(
  store: SsrTimingStore | null,
  layer: string
): SsrTimingPayload | null {
  if (!store || store.flushed) return null;
  store.flushed = true;
  const payload = buildSsrTimingPayload(store, layer);
  console.info(JSON.stringify(payload));
  return payload;
}
