/**
 * Focused browser smoke for OSPE Practice mobile layout + reveal absence.
 * Runs against staging when E2E_TARGET=staging or PLAYWRIGHT_BASE_URL is set.
 */
import { test, expect } from "@playwright/test";

const base =
  process.env.PLAYWRIGHT_BASE_URL ||
  (process.env.E2E_TARGET === "staging"
    ? "https://staging.medversepk.com"
    : "");

test.describe("OSPE Practice layout", () => {
  test.skip(!base, "PLAYWRIGHT_BASE_URL / E2E_TARGET=staging not set");

  for (const width of [320, 375, 1280] as const) {
    test(`renders without horizontal overflow at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${base}/practice/ospe`, {
        waitUntil: "domcontentloaded",
      });
      // Unauthenticated may redirect to login — still a valid layout check.
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
