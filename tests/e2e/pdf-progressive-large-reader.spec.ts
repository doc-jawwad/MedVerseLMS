/**
 * Staging: progressive range reader for large free-folder PDFs.
 *
 *   E2E_TARGET=staging E2E_PDF_MATERIAL_ID=<uuid> E2E_EXPECT_BYTES=<n> \
 *     npx playwright test tests/e2e/pdf-progressive-large-reader.spec.ts --timeout=0
 */
import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

const MATERIAL_ID = process.env.E2E_PDF_MATERIAL_ID || "";
const EXPECT_BYTES = Number(process.env.E2E_EXPECT_BYTES || "0");
const RESULT_PATH = process.env.E2E_RESULT_PATH || "";

test.describe("progressive large PDF reader", () => {
  test(`opens material ${MATERIAL_ID || "(set E2E_PDF_MATERIAL_ID)"} with ranges`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    expect(MATERIAL_ID, "E2E_PDF_MATERIAL_ID required").toBeTruthy();
    expect(STAGING_APP_ORIGIN).toContain("staging");
    const e2e = loadE2EEnv();

    const ranges: string[] = [];
    let nextHeavy = 0;
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes(`/api/study-content/${MATERIAL_ID}`)) {
        const r = req.headers()["range"];
        if (r) ranges.push(r);
      }
      if (
        url.startsWith(STAGING_APP_ORIGIN) &&
        req.method() === "POST" &&
        Number(req.headers()["content-length"] ?? "0") > 5 * 1024 * 1024
      ) {
        nextHeavy += 1;
      }
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
    await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/dashboard|academic|materials|library/, {
      timeout: 60_000,
    });

    const t0 = Date.now();
    await page.goto(`/materials/${MATERIAL_ID}/read`);
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 300_000,
    });
    const timeToFirstPageMs = Date.now() - t0;

    await expect(
      page.getByRole("button", { name: /Download PDF/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save for Offline" })
    ).toBeVisible();

    const pageInput = page.getByLabel("Page number");
    await expect(pageInput).toBeVisible();
    const pageLabel = await page.locator("text=/\\/ \\d+/").first().textContent();
    const totalPages = Number((pageLabel || "").replace(/[^\d]/g, "")) || 0;

    // Jump toward the middle / a distant page when available
    if (totalPages > 10) {
      const target = Math.min(totalPages, Math.max(50, Math.floor(totalPages / 2)));
      await pageInput.fill(String(target));
      await page.getByRole("button", { name: "Go" }).click();
      await page.waitForTimeout(2500);
    } else if (await page.getByRole("button", { name: "Next" }).isEnabled()) {
      await page.getByRole("button", { name: "Next" }).click();
      await page.waitForTimeout(1500);
    }

    const html = await page.content();
    expect(html.includes("r2.cloudflarestorage.com")).toBe(false);
    expect(html.includes("X-Amz-Signature")).toBe(false);

    const head = await page.request.fetch(`/api/study-content/${MATERIAL_ID}`, {
      method: "HEAD",
    });
    expect(head.status()).toBe(200);
    expect(head.headers()["accept-ranges"] || "").toMatch(/bytes/i);
    const cl = Number(head.headers()["content-length"] ?? "0");
    if (EXPECT_BYTES > 0) expect(cl).toBe(EXPECT_BYTES);

    expect(nextHeavy).toBe(0);
    // Prefer client Range headers; accept server-coerced leading 206 as well.
    const coerced = await page.evaluate(async (id) => {
      const r = await fetch(`/api/study-content/${id}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      return {
        status: r.status,
        cr: r.headers.get("content-range") || "",
        cl: Number(r.headers.get("content-length") || "0"),
      };
    }, MATERIAL_ID);
    expect(
      ranges.length > 0 ||
        (coerced.status === 206 && coerced.cl > 0 && coerced.cl < EXPECT_BYTES)
    ).toBe(true);
    // First page should appear well before transferring the whole file at ~10MB/s
    if (EXPECT_BYTES >= 100 * 1024 * 1024) {
      expect(timeToFirstPageMs).toBeLessThan(180_000);
    }

    const result = {
      materialId: MATERIAL_ID,
      contentLength: cl,
      timeToFirstPageMs,
      rangeRequestCount: ranges.length,
      coercedLeading206: coerced,
      sampleRanges: ranges.slice(0, 8),
      totalPages,
      nextHeavyPostCount: nextHeavy,
    };
    console.log(JSON.stringify(result));
    if (RESULT_PATH) {
      const fs = await import("node:fs");
      fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    }
  });
});
