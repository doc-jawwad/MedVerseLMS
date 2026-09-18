import "server-only";

import { cache } from "react";
import { after } from "next/server";
import { headers } from "next/headers";
import {
  createSsrTimingStore,
  flushSsrTiming,
  markSsrPageFnEnd,
  runSsrSpan,
  runSsrSpanSync,
  sanitizeSsrTimingToken,
  ssrTimingEnabled,
  type SsrTimingStore,
} from "@/lib/observability/ssr-timing";

const getSsrTimingStore = cache((): SsrTimingStore | null => {
  if (!ssrTimingEnabled()) return null;
  return createSsrTimingStore();
});

export async function bindSsrTiming(route?: string): Promise<void> {
  const store = getSsrTimingStore();
  if (!store) return;
  const h = await headers();
  store.req = sanitizeSsrTimingToken(h.get("x-loadtest-req"));
  store.run = sanitizeSsrTimingToken(h.get("x-loadtest-run"));
  if (route) store.route = sanitizeSsrTimingToken(route, "unknown");
}

export function scheduleSsrTimingFlush(): void {
  const store = getSsrTimingStore();
  if (!store) return;
  after(() => {
    flushSsrTiming(store, "rsc");
  });
}

export async function ssrSpan<T>(
  name: string,
  fn: () => PromiseLike<T>
): Promise<T> {
  return runSsrSpan(getSsrTimingStore(), name, fn);
}

export function ssrSpanSync<T>(name: string, fn: () => T): T {
  return runSsrSpanSync(getSsrTimingStore(), name, fn);
}

export function ssrMarkPageFnEnd(): void {
  markSsrPageFnEnd(getSsrTimingStore());
}
