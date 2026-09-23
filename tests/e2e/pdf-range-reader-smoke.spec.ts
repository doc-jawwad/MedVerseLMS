/**
 * Staging PDF range-reader smoke (Playwright).
 * Run: E2E_TARGET=staging npx playwright test tests/e2e/pdf-range-reader-smoke.spec.ts
 */
import { test, expect } from "@playwright/test";
import { loadE2EEnv } from "./load-e2e-env";

test.describe("pdf range reader staging", () => {
  test("opens in-app reader with Range support and no R2 URL leak", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    // Prefer a known real multi-MB PDF from acceptance fixtures when unset.
    const materialId =
      process.env.E2E_PDF_MATERIAL_ID ||
      "3d642c22-0eef-43fb-b463-1e58a11f3e1e";

    await page.goto("/login");
    await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
    await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/dashboard|materials|library|academic/, {
      timeout: 60_000,
    });

    const rangeSeen: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(`/api/study-content/${materialId}`)) {
        const range = req.headers()["range"];
        if (range) rangeSeen.push(range);
      }
    });

    await page.goto(`/materials/${materialId}/read`);
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId("pdf-offline-status")).toContainText(
      /Available online|Available offline/i
    );
    await expect(
      page.getByRole("button", { name: "Save for Offline" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Download PDF/i })
    ).toHaveCount(0);

    const next = page.getByRole("button", { name: "Next" });
    if (await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(1000);
    }

    const html = await page.content();
    expect(html.includes("r2.cloudflarestorage.com")).toBe(false);
    expect(html.includes("X-Amz-Signature")).toBe(false);

    const head = await page.request.fetch(`/api/study-content/${materialId}`, {
      method: "HEAD",
    });
    expect(head.status()).toBe(200);
    expect(head.headers()["accept-ranges"] || "").toMatch(/bytes/i);

    const partial = await page.request.get(`/api/study-content/${materialId}`, {
      headers: { Range: "bytes=0-7" },
    });
    expect([200, 206]).toContain(partial.status());
    const magic = await partial.body();
    expect(magic.toString("utf8").startsWith("%PDF-")).toBe(true);

    // PDF.js should issue ranges for multi-MB docs; small fixtures may not.
    const size = Number(head.headers()["content-length"] ?? "0");
    if (size > 1024 * 1024) {
      expect(rangeSeen.length).toBeGreaterThan(0);
    }
  });
});
