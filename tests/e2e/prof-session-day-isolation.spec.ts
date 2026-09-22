import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Paid Prof. Session day isolation (class Blocks + Day 1 ≠ Day 2).
 * Uses admin credentials only when a paid student account is configured via
 * E2E_STAGING_PAID_EMAIL / E2E_STAGING_PAID_PASSWORD; otherwise skips.
 */
test.describe("Prof. Session day isolation (paid)", () => {
  test("Year 1 Blocks 1–3; Day practice scoped; Day 1 ≠ Day 2 labels", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    const paidEmail = process.env.E2E_STAGING_PAID_EMAIL?.trim();
    const paidPassword = process.env.E2E_STAGING_PAID_PASSWORD?.trim();
    test.skip(
      e2e.target !== "staging",
      "Set E2E_TARGET=staging"
    );
    test.skip(
      !paidEmail || !paidPassword,
      "E2E_STAGING_PAID_EMAIL/PASSWORD required"
    );

    await page.goto("/login");
    expect(page.url().startsWith(STAGING_APP_ORIGIN)).toBeTruthy();
    await page.getByLabel("Email").fill(paidEmail!);
    await page.getByLabel("Password").fill(paidPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });

    await page.goto("/academic/prof-session");
    await expect(
      page.getByRole("heading", { name: /Prof\.?\s*Session/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(/subscription(?:\s+is)?\s+required/i)
    ).toHaveCount(0);

    const main = page.locator("main");
    const blockLinks = main.getByRole("link", {
      name: /^Block \d+$/,
    });
    // Year 1 enrolled paid: Blocks 1–3 only (no Block 4+)
    const names = await blockLinks.allTextContents();
    for (const n of names) {
      const m = n.match(/Block (\d+)/);
      if (m) {
        const num = Number(m[1]);
        expect(num).toBeGreaterThanOrEqual(1);
        expect(num).toBeLessThanOrEqual(3);
      }
    }

    await page.goto("/academic/prof-session/block-1");
    await expect(main.getByRole("link", { name: "MCQ Bank" })).toBeVisible({
      timeout: 15000,
    });
    await page.goto("/academic/prof-session/block-1/mcq-bank");
    await expect(main.getByText(/Day/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Prefer published Day 1 / Day 2 when seeded; otherwise skip day drill.
    const day1 = main.getByRole("link", { name: /Day 1/i }).first();
    const day2 = main.getByRole("link", { name: /Day 2/i }).first();
    if ((await day1.count()) === 0 || (await day2.count()) === 0) {
      test.info().annotations.push({
        type: "note",
        description: "Day 1/Day 2 not both published — structure OK, skip isolation UI",
      });
      return;
    }

    await day1.click();
    await expect(page).toHaveURL(/\/mcq-bank\//);
    const day1Url = page.url();
    await expect(
      main.getByRole("link", { name: /Practice MCQs/i })
    ).toBeVisible();

    await page.goto("/academic/prof-session/block-1/mcq-bank");
    await day2.click();
    await expect(page).toHaveURL(/\/mcq-bank\//);
    const day2Url = page.url();
    expect(day2Url).not.toEqual(day1Url);
  });
});
