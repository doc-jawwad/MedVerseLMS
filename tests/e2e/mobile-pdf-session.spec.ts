/**
 * Mobile PDF reader + auth reopen + PWA update wiring (staging).
 * Run: E2E_TARGET=staging npx playwright test tests/e2e/mobile-pdf-session.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { loadE2EEnv } from "./load-e2e-env";

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
] as const;

async function loginStudent(page: Page) {
  const e2e = loadE2EEnv();
  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
  await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard|materials|library|academic|notes|one-liner/, {
    timeout: 60_000,
  });
}

test.describe("mobile session + pdf reader", () => {
  for (const vp of VIEWPORTS) {
    test(`auth reopen stays signed in @ ${vp.width}x${vp.height}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: vp });
      const page = await context.newPage();
      await loginStudent(page);

      // Simulate quit/reopen: new page with same storage, hit PWA start_url "/".
      const reopened = await context.newPage();
      await reopened.goto("/");
      await reopened.waitForURL(/dashboard|admin/, { timeout: 30_000 });
      await expect(reopened).not.toHaveURL(/\/login/);
      await expect(
        reopened.getByRole("link", { name: /Sign in/i })
      ).toHaveCount(0);

      await context.close();
    });
  }

  test("mobile pdf: fit chrome nav fullscreen and resume page", async ({
    browser,
  }) => {
    const e2e = loadE2EEnv();
    // Prefer a free Notes PDF (year 1) so free staging student can open it.
    const materialId =
      process.env.E2E_PDF_MATERIAL_ID ||
      "a59b5f29-28d0-4e2f-84ee-7a3aac1aad54";

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await loginStudent(page);

    await page.goto(`/materials/${materialId}/read`);
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId("pdf-page-stage")).toBeVisible();

    // Reveal chrome if auto-hidden (tap mid-page; avoid overlay hit-box).
    const chrome = page.locator('[data-testid="pdf-viewer"]');
    async function ensureChrome() {
      if ((await chrome.getAttribute("data-chrome")) === "hidden") {
        const box = await page.getByTestId("pdf-page-stage").boundingBox();
        if (box) {
          await page.mouse.click(
            box.x + box.width / 2,
            box.y + Math.min(box.height / 2, 120)
          );
        }
      }
      await expect(page.getByTestId("pdf-prev")).toBeVisible({ timeout: 5_000 });
    }
    await ensureChrome();
    await expect(page.getByTestId("pdf-next")).toBeVisible();
    await expect(page.getByTestId("pdf-fit-width")).toBeVisible();

    await page.getByTestId("pdf-fit-width").click();

    const indicator = page.getByTestId("pdf-page-indicator");
    await expect(indicator).toContainText("/");
    const totalText = (await indicator.textContent()) || "/ 1";
    const total = Math.max(1, Number(totalText.replace(/[^\d]/g, "")) || 1);
    const targetPage = Math.min(15, total);

    await page.getByTestId("pdf-page-input").fill(String(targetPage));
    await page.getByTestId("pdf-page-input").press("Enter");
    await expect(page.getByTestId("pdf-page-input")).toHaveValue(
      String(targetPage),
      { timeout: 15_000 }
    );

    // Fullscreen still exposes nav (not close-only).
    await ensureChrome();
    await page.getByTestId("pdf-fullscreen").click();
    await page.waitForTimeout(500);
    await ensureChrome();
    await expect(page.getByTestId("pdf-next")).toBeVisible();
    await expect(page.getByTestId("pdf-fullscreen-close")).toBeVisible();
    await page.getByTestId("pdf-fullscreen-close").click();

    // Leave and reopen — resume at saved page (server or localStorage).
    await page.goto("/dashboard");
    await page.goto(`/materials/${materialId}/read`);
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({
      timeout: 120_000,
    });
    await ensureChrome();
    await expect(page.getByTestId("pdf-page-input")).toHaveValue(
      String(targetPage),
      { timeout: 30_000 }
    );

    // Landscape smoke
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByTestId("pdf-viewer")).toBeVisible();

    // Desktop regression viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("pdf-viewer")).toBeVisible();
    await ensureChrome();
    await expect(page.getByTestId("pdf-next")).toBeVisible();

    void e2e;
    await context.close();
  });

  test("service worker install does not auto skipWaiting", async ({
    request,
  }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    const installBlock = body.slice(
      body.indexOf('addEventListener("install"'),
      body.indexOf('addEventListener("activate"')
    );
    expect(installBlock).not.toMatch(/self\.skipWaiting\s*\(/);
    expect(body).toContain("SKIP_WAITING");
  });
});
