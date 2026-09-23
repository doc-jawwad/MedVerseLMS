/**
 * Staging: Save for Offline → offline reopen (manageable free PDF).
 *
 *   E2E_TARGET=staging npx playwright test tests/e2e/pdf-offline-save.spec.ts --timeout=0
 */
import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

// Free Notes Sample — Range Reader Free 20MB
const MATERIAL_ID =
  process.env.E2E_PDF_MATERIAL_ID || "2607b1b5-632a-40c5-a907-769df99a6d92";

test.describe("pdf offline save", () => {
  test("save for offline, confirm size, reopen from cache", async ({
    page,
    context,
  }) => {
    test.setTimeout(600_000);
    expect(STAGING_APP_ORIGIN).toContain("staging");
    const e2e = loadE2EEnv();

    await page.goto("/login");
    await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
    await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/dashboard|academic|materials|library/, {
      timeout: 60_000,
    });

    await page.goto(`/materials/${MATERIAL_ID}/read`);
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });

    await page.getByTestId("pdf-save-offline").click();
    await expect(page.getByTestId("pdf-offline-confirm")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("pdf-offline-confirm").click();
    await expect(page.getByTestId("pdf-offline-status")).toContainText(
      /Available offline/i,
      { timeout: 480_000 }
    );

    // Simulate offline: block network for document API; prefer offline path via CDP
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId("pdf-offline-status")).toContainText(
      /offline/i
    );
    const next = page.getByRole("button", { name: "Next" });
    if (await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(800);
    }
    await expect(page.getByTestId("pdf-viewer")).toBeVisible();

    await context.setOffline(false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });
  });
});
