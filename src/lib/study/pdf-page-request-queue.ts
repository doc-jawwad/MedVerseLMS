/** Bounded, demand-driven page requests shared by measurement and rendering. */
export function createPdfPageRequestQueue<Page>(
  load: (pageNumber: number) => Promise<Page>,
  options: { pageCount: number; concurrency?: number; isCurrent: () => boolean }
) {
  type Request = {
    pageNumber: number;
    priority: number;
    promise: Promise<Page>;
    resolve: (page: Page) => void;
    reject: (error: unknown) => void;
  };
  const limit = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 2) || 1));
  const queued = new Map<number, Request>();
  const running = new Map<number, Request>();
  let cancelled = false;
  const active = () => !cancelled && options.isCurrent();
  const cancelledError = () => new Error("PDF page requests cancelled");

  function cancel() {
    cancelled = true;
    for (const request of queued.values()) request.reject(cancelledError());
    queued.clear();
    for (const request of running.values()) request.reject(cancelledError());
  }

  function pump() {
    if (!active()) {
      cancel();
      return;
    }
    while (running.size < limit && queued.size) {
      let next: Request | undefined;
      for (const request of queued.values()) {
        if (!next || request.priority > next.priority) next = request;
      }
      if (!next) break;
      const request = next;
      queued.delete(request.pageNumber);
      running.set(request.pageNumber, request);
      void Promise.resolve().then(() => {
        if (!active()) throw cancelledError();
        return load(request.pageNumber);
      }).then((page) => {
        if (active()) request.resolve(page);
        else request.reject(cancelledError());
      }, request.reject).finally(() => {
        running.delete(request.pageNumber);
        pump();
      });
    }
  }

  function requestPage(pageNumber: number, priority = 0): Promise<Page> {
    if (!active()) {
      cancel();
      return Promise.reject(cancelledError());
    }
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > options.pageCount) {
      return Promise.reject(new RangeError("Invalid PDF page number"));
    }
    const pending = running.get(pageNumber) ?? queued.get(pageNumber);
    if (pending) {
      pending.priority = Math.max(pending.priority, priority);
      return pending.promise;
    }
    let resolve!: Request["resolve"];
    let reject!: Request["reject"];
    const promise = new Promise<Page>((ok, fail) => { resolve = ok; reject = fail; });
    queued.set(pageNumber, { pageNumber, priority, promise, resolve, reject });
    pump();
    return promise;
  }

  // Reprioritize queued work after a jump/scroll; do not interrupt active renders.
  function prioritize(priorityForPage: (pageNumber: number) => number) {
    for (const request of queued.values()) request.priority = priorityForPage(request.pageNumber);
    pump();
  }

  return { requestPage, prioritize, cancel };
}
