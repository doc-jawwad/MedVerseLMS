import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyServiceWorkerUpdate } from "../../src/lib/pwa/apply-update.ts";

describe("PWA deferred update activation", () => {
  it("public/sw.js does not auto skipWaiting on install", () => {
    const sw = readFileSync(
      path.join(process.cwd(), "public/sw.js"),
      "utf8"
    );
    assert.match(sw, /addEventListener\("install"/);
    assert.match(sw, /data\.type === "SKIP_WAITING"/);
    assert.match(sw, /self\.skipWaiting\(\)/);
    // Install must not *call* skipWaiting — comments may mention the word.
    const installBlock = sw.slice(
      sw.indexOf('addEventListener("install"'),
      sw.indexOf('addEventListener("activate"')
    );
    assert.doesNotMatch(installBlock, /self\.skipWaiting\s*\(/);
    const messageBlock = sw.slice(sw.indexOf('addEventListener("message"'));
    assert.match(messageBlock, /SKIP_WAITING[\s\S]*self\.skipWaiting\s*\(/);
  });

  it("applyUpdate posts SKIP_WAITING and reloads on controllerchange", () => {
    const messages: unknown[] = [];
    let reloadCount = 0;
    const handlers: Array<() => void> = [];
    const worker = {
      postMessage(data: unknown) {
        messages.push(data);
      },
    } as ServiceWorker;

    applyServiceWorkerUpdate({
      getWaiting: () => worker,
      postSkipWaiting: (sw) => {
        sw.postMessage({ type: "SKIP_WAITING" });
      },
      addControllerChangeListener: (handler) => {
        handlers.push(handler);
      },
      removeControllerChangeListener: () => {
        handlers.length = 0;
      },
      reload: () => {
        reloadCount += 1;
      },
      fallbackMs: 1500,
      schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
      clearSchedule: () => undefined,
    });

    assert.deepEqual(messages, [{ type: "SKIP_WAITING" }]);
    assert.equal(reloadCount, 0);
    assert.equal(handlers.length, 1);
    const onChange = handlers[0]!;
    onChange();
    assert.equal(reloadCount, 1);
    // Second controllerchange must not double-reload.
    onChange();
    assert.equal(reloadCount, 1);
  });

  it("applyUpdate reloads via timeout when controllerchange is missed", () => {
    let reloadCount = 0;
    const scheduled: Array<() => void> = [];
    const worker = {
      postMessage() {
        /* noop */
      },
    } as ServiceWorker;

    applyServiceWorkerUpdate({
      getWaiting: () => worker,
      postSkipWaiting: (sw) => {
        sw.postMessage({ type: "SKIP_WAITING" });
      },
      addControllerChangeListener: () => undefined,
      removeControllerChangeListener: () => undefined,
      reload: () => {
        reloadCount += 1;
      },
      fallbackMs: 1500,
      schedule: (fn) => {
        scheduled.push(fn);
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearSchedule: () => undefined,
    });

    assert.equal(reloadCount, 0);
    assert.equal(scheduled.length, 1);
    scheduled[0]!();
    assert.equal(reloadCount, 1);
  });

  it("applyUpdate reloads immediately when no waiting worker", () => {
    let reloadCount = 0;
    applyServiceWorkerUpdate({
      getWaiting: () => null,
      postSkipWaiting: () => {
        throw new Error("should not post");
      },
      addControllerChangeListener: () => undefined,
      removeControllerChangeListener: () => undefined,
      reload: () => {
        reloadCount += 1;
      },
      schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
      clearSchedule: () => undefined,
    });
    assert.equal(reloadCount, 1);
  });

  it("provider wires applyServiceWorkerUpdate", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/components/pwa/pwa-runtime-provider.tsx"
      ),
      "utf8"
    );
    assert.match(src, /applyServiceWorkerUpdate/);
    assert.match(src, /fallbackMs:\s*1500/);
    assert.match(src, /SKIP_WAITING/);
  });
});
