/**
 * Staging: Offline Library cold-start + OPFS range reopen + entitlement.
 *
 *   E2E_TARGET=staging npx playwright test tests/e2e/pdf-offline-library.spec.ts --timeout=0
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

const FREE_MATERIAL =
  process.env.E2E_PDF_MATERIAL_ID || "2607b1b5-632a-40c5-a907-769df99a6d92";

function makeMultiPagePdf(): string {
  const out = path.join(os.tmpdir(), `mv-multipage-${Date.now()}.pdf`);
  const r = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "scripts/gen-multipage-pdf.mjs"),
      out,
      "40",
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    throw new Error(`multipage pdf failed: ${r.stderr || r.stdout}`);
  }
  return out;
}

async function loginStudent(page: import("@playwright/test").Page) {
  const e2e = loadE2EEnv();
  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
  await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard|academic|materials|library/, {
    timeout: 60_000,
  });
}

async function ensureSavedOffline(page: import("@playwright/test").Page) {
  await page.goto(`/materials/${FREE_MATERIAL}/read`);
  await expect(page.getByTestId("pdf-viewer")).toBeVisible({
    timeout: 120_000,
  });
  const status = page.getByTestId("pdf-offline-status");
  const already = await status.innerText();
  if (!/Available offline/i.test(already)) {
    await page.getByTestId("pdf-save-offline").click();
    await expect(page.getByTestId("pdf-offline-confirm")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("pdf-offline-confirm").click();
    await expect(status).toContainText(/Available offline/i, {
      timeout: 480_000,
    });
  }
}

test.describe("offline library hardening", () => {
  test("A/B: cold-start shell + OPFS reopen + distant pages + remove", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(600_000);
    expect(STAGING_APP_ORIGIN).toContain("staging");

    await loginStudent(page);

    // Warm SW + Offline Library shell while online
    await page.goto("/offline");
    await expect(page.getByTestId("offline-library")).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);

    await ensureSavedOffline(page);

    // Ask SW to cache reader path
    await page.goto(`/offline/read/${FREE_MATERIAL}`);
    await expect(page.getByTestId("offline-reader-page")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });
    await page.waitForTimeout(2000);

    const storageState = await context.storageState();
    await page.close();

    // Cold reopen: new context, network offline, Offline Library from SW shell
    const offlineCtx = await browser.newContext({
      storageState,
      baseURL: STAGING_APP_ORIGIN,
      serviceWorkers: "allow",
    });
    await offlineCtx.setOffline(true);
    const cold = await offlineCtx.newPage();

    await cold.goto("/offline", { waitUntil: "domcontentloaded" });
    await expect(cold.getByTestId("offline-library")).toBeVisible({
      timeout: 60_000,
    });
    await expect(cold.getByTestId("offline-library-item").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(cold.getByTestId("offline-library-status").first()).toContainText(
      /Available offline/i
    );

    await cold.getByRole("link", { name: "Open" }).first().click();
    await expect(cold.getByTestId("offline-reader-page")).toBeVisible({
      timeout: 60_000,
    });
    await expect(cold.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });
    await expect(cold.getByTestId("pdf-offline-status")).toContainText(
      /cached copy|Available offline/i
    );

    // Distant page jump (middle / last when multi-page)
    const pageCountText = await cold
      .locator("span.text-xs.text-muted-foreground")
      .filter({ hasText: /^\// })
      .first()
      .innerText()
      .catch(() => "");
    const countMatch = pageCountText.match(/\/\s*(\d+)/);
    const pageCount = countMatch ? Number(countMatch[1]) : 1;
    if (pageCount >= 3) {
      const mid = Math.floor(pageCount / 2);
      await cold.getByLabel("Page number").fill(String(mid));
      await cold.getByRole("button", { name: "Go" }).click();
      await cold.waitForTimeout(800);
      await expect(cold.getByTestId("pdf-viewer")).toBeVisible();
      await cold.getByLabel("Page number").fill(String(pageCount));
      await cold.getByRole("button", { name: "Go" }).click();
      await cold.waitForTimeout(800);
      await expect(cold.getByTestId("pdf-viewer")).toBeVisible();
    } else {
      const next = cold.getByRole("button", { name: "Next" });
      if (await next.isEnabled()) {
        await next.click();
        await cold.waitForTimeout(500);
      }
    }

    // Memory: usedJSHeapSize must not jump by whole PDF size (when available)
    const mem = await cold.evaluate(async () => {
      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number };
      };
      const used = perf.memory?.usedJSHeapSize ?? null;
      // Probe OPFS meta size without loading bytes into RAM
      const open = indexedDB.open("medverse-pdf-offline-v1", 1);
      const meta = await new Promise<{ byteSize?: number } | null>((resolve) => {
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("meta")) {
            resolve(null);
            return;
          }
          const tx = db.transaction("meta", "readonly");
          const req = tx.objectStore("meta").getAll();
          req.onsuccess = () => {
            const rows = (req.result as Array<{ byteSize?: number }>) ?? [];
            resolve(rows[0] ?? null);
          };
          req.onerror = () => resolve(null);
        };
        open.onerror = () => resolve(null);
      });
      return { used, byteSize: meta?.byteSize ?? 0 };
    });
    if (mem.used != null && mem.byteSize > 8 * 1024 * 1024) {
      // Heap should stay well below full file size (allow 2× chunk headroom)
      expect(mem.used).toBeLessThan(mem.byteSize * 0.75);
    }

    await offlineCtx.setOffline(false);
    await cold.goto("/offline");
    await cold.getByRole("button", { name: "Remove offline" }).first().click();
    await cold.waitForTimeout(800);
    await offlineCtx.close();
  });

  test("D: entitlement expiry hides offline content", async ({ page }) => {
    test.setTimeout(300_000);
    expect(STAGING_APP_ORIGIN).toContain("staging");
    await loginStudent(page);
    await ensureSavedOffline(page);

    await page.goto("/offline");
    await expect(page.getByTestId("offline-library-item").first()).toBeVisible({
      timeout: 30_000,
    });

    // Force entitlement past due in IndexedDB (client-side expiry check)
    await page.evaluate(async (materialId) => {
      const open = indexedDB.open("medverse-pdf-offline-v1", 1);
      await new Promise<void>((resolve, reject) => {
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("meta", "readwrite");
          const store = tx.objectStore("meta");
          const get = store.get(materialId);
          get.onsuccess = () => {
            const row = get.result as Record<string, unknown> | undefined;
            if (row) {
              store.put({ ...row, entitlementExpiresAt: Date.now() - 1000 });
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
    }, FREE_MATERIAL);

    await page.reload();
    await expect(page.getByTestId("offline-library")).toBeVisible();
    // purgeExpiredOffline removes rows, or status shows expired before purge
    const items = page.getByTestId("offline-library-item");
    const count = await items.count();
    if (count > 0) {
      await expect(page.getByTestId("offline-library-status").first()).toContainText(
        /expired|Unavailable/i
      );
    }
  });

  test("multipage fixture generates searchable pages", async () => {
    const pdfPath = makeMultiPagePdf();
    const buf = fs.readFileSync(pdfPath);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(buf.toString("latin1")).toContain("MedVerse page 1 of 40");
    expect(buf.toString("latin1")).toContain("MedVerse page 20 of 40");
    expect(buf.toString("latin1")).toContain("MedVerse page 40 of 40");
    fs.unlinkSync(pdfPath);
  });
});
