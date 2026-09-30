/** Shared PWA update activation — kept pure for unit tests. */

export type ApplyUpdateDeps = {
  getWaiting: () => ServiceWorker | null | undefined;
  postSkipWaiting: (worker: ServiceWorker) => void;
  addControllerChangeListener: (handler: () => void) => void;
  removeControllerChangeListener: (handler: () => void) => void;
  reload: () => void;
  /** Fallback reload if controllerchange was already consumed (ms). */
  fallbackMs?: number;
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule: (id: ReturnType<typeof setTimeout>) => void;
};

/**
 * Activate a waiting service worker and reload exactly once.
 * Registers controllerchange BEFORE posting SKIP_WAITING, with a short
 * timeout fallback when activation already happened and the event was missed.
 */
export function applyServiceWorkerUpdate(deps: ApplyUpdateDeps): void {
  const worker = deps.getWaiting();
  if (!worker) {
    deps.reload();
    return;
  }

  let reloading = false;
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    deps.clearSchedule(timer);
    deps.removeControllerChangeListener(onControllerChange);
    deps.reload();
  };

  const onControllerChange = () => {
    reloadOnce();
  };

  deps.addControllerChangeListener(onControllerChange);
  const timer = deps.schedule(reloadOnce, deps.fallbackMs ?? 1500);

  try {
    deps.postSkipWaiting(worker);
  } catch {
    reloadOnce();
  }
}
