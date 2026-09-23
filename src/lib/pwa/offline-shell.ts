/** Helpers for the minimal offline PDF shell (SW-cached /offline routes). */

export const OFFLINE_LIBRARY_PATH = "/offline";
export const OFFLINE_SHELL_CACHE = "medverse-shell-v1";

export function offlineReaderPath(materialId: string): string {
  return `/offline/read/${materialId}`;
}

/** Ask the service worker to cache the offline reader document for cold start. */
export function requestCacheOfflineReader(materialId: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const path = offlineReaderPath(materialId);
  void navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage({
        type: "CACHE_OFFLINE_SHELL",
        paths: [OFFLINE_LIBRARY_PATH, path],
      });
    })
    .catch(() => undefined);
}
