import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPdfPageRequestQueue } from "../../src/lib/study/pdf-page-request-queue.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function controlled(concurrency = 1) {
  const calls: number[] = [];
  const pending = new Map<number, { resolve: (n: number) => void; reject: (e: Error) => void }>();
  let current = true;
  const queue = createPdfPageRequestQueue<number>((n) => {
    calls.push(n);
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  }, { pageCount: 20, concurrency, isCurrent: () => current });
  return { queue, calls, pending, stale: () => { current = false; } };
}

describe("PDF page request queue", () => {
  it("deduplicates pending and active requests and promotes a queued page", async () => {
    const { queue, calls, pending } = controlled();
    const one = queue.requestPage(1);
    assert.equal(queue.requestPage(1), one);
    const two = queue.requestPage(2);
    const three = queue.requestPage(3);
    assert.equal(queue.requestPage(3, 10), three);
    await tick();
    assert.deepEqual(calls, [1]);
    pending.get(1)!.resolve(1);
    await tick();
    assert.deepEqual(calls, [1, 3]);
    pending.get(3)!.resolve(3);
    await tick();
    pending.get(2)!.resolve(2);
    assert.deepEqual(await Promise.all([one, two, three]), [1, 2, 3]);
  });

  it("caps concurrency and reprioritizes queued work after navigation", async () => {
    const { queue, calls, pending } = controlled(2);
    const promises = [1, 2, 3, 4, 5].map((n) => queue.requestPage(n));
    await tick();
    assert.deepEqual(calls, [1, 2]);
    queue.prioritize((n) => -Math.abs(5 - n));
    pending.get(1)!.resolve(1);
    await tick();
    assert.deepEqual(calls, [1, 2, 5]);
    pending.get(2)!.resolve(2);
    await tick();
    assert.deepEqual(calls, [1, 2, 5, 4]);
    pending.get(5)!.resolve(5);
    await tick();
    pending.get(4)!.resolve(4);
    pending.get(3)!.resolve(3);
    assert.deepEqual(await Promise.all(promises), [1, 2, 3, 4, 5]);
  });

  it("cancels running and queued requests without starting stale work", async () => {
    const { queue, calls, pending } = controlled();
    const results = Promise.allSettled([queue.requestPage(1), queue.requestPage(2)]);
    await tick();
    queue.cancel();
    assert.ok((await results).every((r) => r.status === "rejected"));
    pending.get(1)!.resolve(1);
    await tick();
    assert.deepEqual(calls, [1]);
    await assert.rejects(queue.requestPage(3), /cancelled/);
  });

  it("discards a late result from an obsolete document generation", async () => {
    const { queue, calls, pending, stale } = controlled();
    const results = Promise.allSettled([queue.requestPage(1), queue.requestPage(2)]);
    await tick();
    stale();
    pending.get(1)!.resolve(1);
    assert.ok((await results).every((r) => r.status === "rejected"));
    assert.deepEqual(calls, [1]);
  });

  it("releases capacity after a failed request and allows a later retry", async () => {
    const { queue, calls, pending } = controlled();
    const first = assert.rejects(queue.requestPage(1), /bad page/);
    const second = queue.requestPage(2);
    await tick();
    pending.get(1)!.reject(new Error("bad page"));
    await first;
    await tick();
    pending.get(2)!.resolve(2);
    assert.equal(await second, 2);
    const retry = queue.requestPage(1);
    await tick();
    pending.get(1)!.resolve(1);
    assert.equal(await retry, 1);
    assert.deepEqual(calls, [1, 2, 1]);
  });

  it("rejects invalid page numbers without calling the loader", async () => {
    const { queue, calls } = controlled();
    for (const n of [0, 21, 1.5, NaN]) await assert.rejects(queue.requestPage(n), RangeError);
    assert.deepEqual(calls, []);
  });
});
