import { test, expect, type Page } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

const YEAR = "42eded74-a867-4045-81e4-e438b082d8b3";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  expect(page.url().startsWith(STAGING_APP_ORIGIN)).toBeTruthy();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30000 });
}

test.describe("Admin subscriptions serial + month filter", () => {
  test("month filter, counts, serials, search, and mobile", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "E2E_TARGET=staging required");
    test.skip(!e2e.adminEmail || !e2e.adminPassword, "admin credentials required");

    await login(page, e2e.adminEmail, e2e.adminPassword);

    const mainTable = page.locator("div.overflow-x-auto").first().locator("table");
    await page.goto(`/admin/subscriptions?year=${YEAR}`);
    await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
    await expect(page.getByText(/^17 subscriptions/)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "#" })).toBeVisible();
    await expect(mainTable.locator("tbody tr")).toHaveCount(17);
    await expect(mainTable.locator("tbody tr").first().locator("td").first()).toHaveText("1");
    await expect(mainTable.locator("tbody tr").nth(16).locator("td").first()).toHaveText("17");
    await expect(page.locator('select[name="month"]')).toBeVisible();

    await page.goto(
      `/admin/subscriptions?year=${YEAR}&month=2026-09`
    );
    await expect(page.getByText(/17 subscriptions started in September 2026/)).toBeVisible();
    await expect(mainTable.locator("tbody tr")).toHaveCount(17);
    await expect(mainTable.locator("tbody tr").first().locator("td").first()).toHaveText("1");

    await page.goto(
      `/admin/subscriptions?year=${YEAR}&month=2026-10`
    );
    await expect(page.getByText(/0 subscriptions started in October 2026/)).toBeVisible();
    await expect(page.getByText("No subscriptions match for this class.")).toBeVisible();

    await page.goto(
      `/admin/subscriptions?year=${YEAR}&month=2026-09&status=active`
    );
    const activeCount = await page
      .locator("p.text-sm.text-muted-foreground")
      .filter({ hasText: /started in September 2026 matching current filters/ })
      .textContent();
    expect(activeCount).toMatch(/^\d+ subscription/);
    const n = Number(activeCount?.match(/^(\d+)/)?.[1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(17);
    await expect(mainTable.locator("tbody tr")).toHaveCount(n);
    await expect(mainTable.locator("tbody tr").first().locator("td").first()).toHaveText("1");
    if (n >= 2) {
      await expect(mainTable.locator("tbody tr").nth(n - 1).locator("td").first()).toHaveText(String(n));
    }

    await page.goto(
      `/admin/subscriptions?year=${YEAR}&month=2026-09&q=zzznomatchxyz`
    );
    await expect(
      page.getByText(/0 subscriptions started in September 2026 matching current filters/)
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/subscriptions?year=${YEAR}&month=2026-09`);
    await expect(page.locator('select[name="month"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
    await expect(page.getByText(/17 subscriptions started in September 2026/)).toBeVisible();
  });

  test("unauthenticated admin subscriptions stays behind login", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "E2E_TARGET=staging required");
    const res = await page.goto(`/admin/subscriptions?year=${YEAR}`);
    expect(res?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });
});
