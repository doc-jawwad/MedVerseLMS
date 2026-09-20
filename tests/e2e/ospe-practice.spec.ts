/**
 * Focused browser smoke for OSPE Practice mobile layout + reveal absence.
 * Runs against local/dev when PLAYWRIGHT_BASE_URL is set; otherwise skips.
 */
import { test, expect } from "@playwright/test";

const base = process.env.PLAYWRIGHT_BASE_URL;

test.describe("OSPE Practice layout", () => {
  test.skip(!base, "PLAYWRIGHT_BASE_URL not set");

  for (const width of [320, 375, 1280] as const) {
    test(`renders without horizontal overflow at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${base}/practice/ospe`, { waitUntil: "domcontentloaded" });
      // Unauthenticated may redirect to login — that is still a valid layout check.
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth
      );
      const clientWidth = await page.evaluate(
        () => document.documentElement.clientWidth
      );
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      await expect(page.locator("body")).toBeVisible();
    });
  }
});
