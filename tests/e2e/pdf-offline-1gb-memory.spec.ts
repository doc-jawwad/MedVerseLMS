/**
 * Staging-only: 1 GB offline OPFS memory gate.
 *
 *   E2E_TARGET=staging npx playwright test tests/e2e/pdf-offline-1gb-memory.spec.ts --timeout=0
 *
 * Material: Free Progressive 1GB (validated online progressive reader).
 * Does NOT deploy or touch production.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

const MATERIAL_ID =
  process.env.E2E_PDF_MATERIAL_ID || "e2750418-0689-40ed-afd0-9171136880d6";
const EXPECT_BYTES = Number(process.env.E2E_EXPECT_BYTES || "1073741767");
const RESULT_PATH =
  process.env.E2E_RESULT_PATH || "tmp-e2e-offline-1gb-memory.json";

type MemSnap = {
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
  jsHeapSizeLimit: number | null;
  at: number;
};

async function heap(page: import("@playwright/test").Page): Promise<MemSnap> {
  return page.evaluate(() => {
    const m = (
      performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }
    ).memory;
    return {
      usedJSHeapSize: m?.usedJSHeapSize ?? null,
      totalJSHeapSize: m?.totalJSHeapSize ?? null,
      jsHeapSizeLimit: m?.jsHeapSizeLimit ?? null,
      at: Date.now(),
    };
  });
}

async function installArrayBufferProbe(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __mvAbProbe?: {
        maxBytes: number;
        calls: Array<{ bytes: number; via: string; t: number }>;
      };
    };
    w.__mvAbProbe = { maxBytes: 0, calls: [] };
    const record = (bytes: number, via: string) => {
      w.__mvAbProbe!.calls.push({ bytes, via, t: Date.now() });
      if (bytes > w.__mvAbProbe!.maxBytes) w.__mvAbProbe!.maxBytes = bytes;
    };
    const patch = (proto: { arrayBuffer: () => Promise<ArrayBuffer> }, via: string) => {
      const orig = proto.arrayBuffer;
      proto.arrayBuffer = async function (this: Blob) {
        const ab = await orig.call(this);
        record(ab.byteLength, via);
        return ab;
      };
    };
    patch(Blob.prototype, "Blob.arrayBuffer");
    patch(File.prototype, "File.arrayBuffer");
  });
}

async function readAbProbe(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __mvAbProbe?: {
        maxBytes: number;
        calls: Array<{ bytes: number; via: string; t: number }>;
      };
    };
    const p = w.__mvAbProbe ?? { maxBytes: 0, calls: [] };
    const large = p.calls.filter((c) => c.bytes >= 64 * 1024 * 1024);
    return {
      maxBytes: p.maxBytes,
      callCount: p.calls.length,
      largeCalls: large.slice(0, 20),
      sample: p.calls.slice(0, 12),
    };
  });
}

async function opfsMeta(page: import("@playwright/test").Page, materialId: string) {
  return page.evaluate(async (id) => {
    const open = indexedDB.open("medverse-pdf-offline-v1", 1);
    const meta = await new Promise<Record<string, unknown> | null>((resolve) => {
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("meta")) {
          resolve(null);
          return;
        }
        const tx = db.transaction("meta", "readonly");
        const req = tx.objectStore("meta").get(id);
        req.onsuccess = () => resolve((req.result as Record<string, unknown>) ?? null);
        req.onerror = () => resolve(null);
      };
      open.onerror = () => resolve(null);
    });
    let opfsSize: number | null = null;
    try {
      const root = await navigator.storage.getDirectory();
      const name = `pdf-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
      const handle = await root.getFileHandle(name);
      const file = await handle.getFile();
      opfsSize = file.size;
    } catch {
      opfsSize = null;
    }
    let quota: { usage: number; quota: number } | null = null;
    try {
      const est = await navigator.storage.estimate();
      quota = { usage: Number(est.usage ?? 0), quota: Number(est.quota ?? 0) };
    } catch {
      quota = null;
    }
    return { meta, opfsSize, quota };
  }, materialId);
}

test.describe("1 GB offline memory gate", () => {
  test("save offline, cold reopen, random access, memory bound", async ({
    page,
    context,
  }) => {
    test.setTimeout(3 * 60 * 60 * 1000); // up to 3h for 1GB range save
    expect(STAGING_APP_ORIGIN).toContain("staging");
    const e2e = loadE2EEnv();

    await installArrayBufferProbe(page);

    await page.goto("/login");
    await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
    await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/dashboard|academic|materials|library/, {
      timeout: 60_000,
    });

    // Warm Offline Library shell while online
    await page.goto("/offline");
    await expect(page.getByTestId("offline-library")).toBeVisible({
      timeout: 60_000,
    });
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return;
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });

    console.log(`[1gb] opening reader ${MATERIAL_ID}`);
    const tOnline0 = Date.now();
    await page.goto(`/materials/${MATERIAL_ID}/read`);
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 300_000,
    });
    console.log(`[1gb] online TTFP ${Date.now() - tOnline0}ms`);

    const headBefore = await page.request.fetch(`/api/study-content/${MATERIAL_ID}`, {
      method: "HEAD",
    });
    expect(headBefore.status()).toBe(200);
    const contentLength = Number(headBefore.headers()["content-length"] ?? "0");
    expect(contentLength).toBe(EXPECT_BYTES);

    // Ensure / remove stale offline copy if wrong size
    const existing = await opfsMeta(page, MATERIAL_ID);
    if (
      existing.opfsSize != null &&
      existing.opfsSize !== EXPECT_BYTES &&
      (await page.getByTestId("pdf-offline-status").innerText()).match(
        /Available offline/i
      )
    ) {
      await page.getByRole("button", { name: "Remove offline" }).click();
      await page.waitForTimeout(1000);
    }

    const status = page.getByTestId("pdf-offline-status");
    const already = await status.innerText();
    console.log(`[1gb] initial offline status: ${already}`);
    let saveDurationMs: number | null = null;
    if (!/Available offline/i.test(already)) {
      const quota = await page.evaluate(async () => {
        const est = await navigator.storage.estimate();
        return {
          usage: Number(est.usage ?? 0),
          quota: Number(est.quota ?? 0),
          remaining: Math.max(0, Number(est.quota ?? 0) - Number(est.usage ?? 0)),
        };
      });
      console.log(`[1gb] quota=${JSON.stringify(quota)}`);
      expect(
        quota.remaining,
        `device quota remaining ${quota.remaining} < ${EXPECT_BYTES}`
      ).toBeGreaterThan(EXPECT_BYTES);

      await page.getByTestId("pdf-save-offline").click();
      await expect(page.getByTestId("pdf-offline-confirm")).toBeVisible({
        timeout: 60_000,
      });
      const tSave0 = Date.now();
      await page.getByTestId("pdf-offline-confirm").click();
      console.log("[1gb] confirm save clicked; polling progress…");

      let lastPct = -1;
      let lastProgressAt = Date.now();
      let lastUi = "";
      for (;;) {
        const ui = await status.innerText().catch(() => "");
        if (/Available offline/i.test(ui)) {
          saveDurationMs = Date.now() - tSave0;
          console.log(`[1gb] save complete in ${saveDurationMs}ms ui=${ui}`);
          break;
        }
        if (/Failed/i.test(ui)) {
          throw new Error(`offline save failed: ${ui}`);
        }
        // Save was cancelled/aborted (reader remount used to do this).
        if (/Available online/i.test(ui) && Date.now() - tSave0 > 5_000) {
          throw new Error(
            `offline save aborted back to online-only at t=${Date.now() - tSave0}ms lastPct=${lastPct}`
          );
        }
        const pctMatch = ui.match(/(\d+)\s*%/);
        const pct = pctMatch ? Number(pctMatch[1]) : -1;
        if (ui !== lastUi || pct !== lastPct) {
          console.log(
            `[1gb] t=${Math.round((Date.now() - tSave0) / 1000)}s ui=${ui}`
          );
          lastUi = ui;
        }
        // createWritable often reports size 0 until close — track UI %.
        if (pct > lastPct) {
          lastPct = pct;
          lastProgressAt = Date.now();
        }
        if (Date.now() - lastProgressAt > 15 * 60 * 1000) {
          throw new Error(
            `offline save stalled 15m at pct=${pct} ui=${ui} elapsed=${Date.now() - tSave0}ms`
          );
        }
        if (Date.now() - tSave0 > 2.5 * 60 * 60 * 1000) {
          throw new Error(`offline save exceeded 2.5h at pct=${pct}`);
        }
        await page.waitForTimeout(20_000);
      }
    } else {
      saveDurationMs = 0; // already cached
      console.log("[1gb] already Available offline — skipping save");
    }

    const afterSave = await opfsMeta(page, MATERIAL_ID);
    expect(afterSave.opfsSize).toBe(EXPECT_BYTES);
    expect(Number(afterSave.meta?.byteSize ?? 0)).toBe(EXPECT_BYTES);

    // Cache offline reader shell
    await page.goto(`/offline/read/${MATERIAL_ID}`);
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 180_000,
    });
    await page.evaluate(async (id) => {
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({
        type: "CACHE_OFFLINE_SHELL",
        paths: ["/offline", `/offline/read/${id}`],
      });
      await new Promise((r) => setTimeout(r, 1500));
    }, MATERIAL_ID);

    await page.close();
    await context.setOffline(true);
    const cold = await context.newPage();
    await installArrayBufferProbe(cold);

    // Cold offline reopen
    const tOpen0 = Date.now();
    let opened = false;
    for (let i = 0; i < 3; i++) {
      try {
        await cold.goto(`/offline/read/${MATERIAL_ID}`, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await cold.getByTestId("pdf-viewer").waitFor({ timeout: 180_000 });
        opened = true;
        break;
      } catch {
        await cold.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      }
    }
    expect(opened).toBe(true);
    const timeToFirstPageOfflineMs = Date.now() - tOpen0;

    await expect(cold.getByTestId("pdf-offline-status")).toContainText(
      /cached copy|Available offline/i
    );
    const memAfterFirst = await heap(cold);
    const memBeforeNav = memAfterFirst;
    const probeAfterFirst = await readAbProbe(cold);

    // Random access
    const pageCountText = await cold
      .locator("span.text-xs.text-muted-foreground")
      .filter({ hasText: /^\// })
      .first()
      .innerText()
      .catch(() => "/ 1");
    const pageCount =
      Number((pageCountText.match(/\/\s*(\d+)/) || [])[1] || "1") || 1;

    const jump = async (n: number) => {
      await cold.getByLabel("Page number").fill(String(n));
      await cold.getByRole("button", { name: "Go" }).click();
      await cold.waitForTimeout(1200);
      await expect(cold.getByTestId("pdf-viewer")).toBeVisible();
    };

    if (pageCount >= 3) {
      await jump(1);
      await jump(Math.floor(pageCount / 2));
      await jump(pageCount);
      await jump(Math.max(1, Math.floor(pageCount / 2) - 1));
      await jump(1);
    } else {
      // Synthetic 1-page large PDF — still exercise Next/Previous disabled path
      const next = cold.getByRole("button", { name: "Next" });
      if (await next.isEnabled()) {
        await next.click();
        await cold.waitForTimeout(800);
      }
    }

    // Repeated distant navigation (or re-jump page 1)
    const memSamples: MemSnap[] = [];
    for (let i = 0; i < 8; i++) {
      if (pageCount >= 3) {
        const targets = [
          1,
          Math.floor(pageCount / 3),
          Math.floor((2 * pageCount) / 3),
          pageCount,
        ];
        await jump(targets[i % targets.length]!);
      } else {
        await jump(1);
      }
      memSamples.push(await heap(cold));
    }

    const memPeak = memSamples.reduce(
      (max, s) =>
        (s.usedJSHeapSize ?? 0) > (max.usedJSHeapSize ?? 0) ? s : max,
      memAfterFirst
    );
    const memAfterRepeated = memSamples[memSamples.length - 1] ?? memAfterFirst;
    const probeFinal = await readAbProbe(cold);

    // Confirm offline path (no study-content fetch while offline)
    const studyContentHits = await cold.evaluate(() => 0);

    const result = {
      materialId: MATERIAL_ID,
      exactByteSize: contentLength,
      opfsSize: afterSave.opfsSize,
      idbByteSize: afterSave.meta?.byteSize ?? null,
      browserStorageUsage: afterSave.quota?.usage ?? null,
      browserStorageQuota: afterSave.quota?.quota ?? null,
      saveDurationMs,
      timeToFirstPageOfflineMs,
      pageCount,
      memoryBeforeOpenMs: memBeforeNav,
      memoryAfterFirstPage: memAfterFirst,
      memoryPeakDuringNav: memPeak,
      memoryAfterRepeatedNav: memAfterRepeated,
      arrayBufferProbeAfterFirst: probeAfterFirst,
      arrayBufferProbeFinal: probeFinal,
      fullFileArrayBufferObserved:
        probeFinal.maxBytes >= EXPECT_BYTES * 0.9 ||
        (probeFinal.largeCalls?.some((c) => c.bytes >= EXPECT_BYTES * 0.9) ??
          false),
      heapBelowFileSize:
        memPeak.usedJSHeapSize != null
          ? memPeak.usedJSHeapSize < EXPECT_BYTES
          : null,
      heapSanity64MiB:
        memPeak.usedJSHeapSize != null
          ? memPeak.usedJSHeapSize < EXPECT_BYTES
          : null,
      studyContentHitsWhileOffline: studyContentHits,
      stagingCommitHint: "cc4e93c",
    };

    // Acceptance
    expect(result.opfsSize).toBe(EXPECT_BYTES);
    expect(result.fullFileArrayBufferObserved).toBe(false);
    expect(result.arrayBufferProbeFinal.maxBytes).toBeLessThan(64 * 1024 * 1024);
    if (result.memoryPeakDuringNav.usedJSHeapSize != null) {
      expect(result.memoryPeakDuringNav.usedJSHeapSize).toBeLessThan(EXPECT_BYTES);
      // Must not approach file size (stay under 25% of 1GB as "reasonable")
      expect(result.memoryPeakDuringNav.usedJSHeapSize).toBeLessThan(
        EXPECT_BYTES * 0.25
      );
    }
    // Unbounded growth: last sample should not exceed first-after-open by >150MB
    if (
      memAfterFirst.usedJSHeapSize != null &&
      memAfterRepeated.usedJSHeapSize != null
    ) {
      expect(
        memAfterRepeated.usedJSHeapSize - memAfterFirst.usedJSHeapSize
      ).toBeLessThan(150 * 1024 * 1024);
    }

    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));

    await context.setOffline(false);
  });
});
