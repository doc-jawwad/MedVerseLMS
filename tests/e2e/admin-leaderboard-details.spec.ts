import { test, expect, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  provisionExamFixture,
  teardownExamFixture,
} from "./fixtures";
import { loadE2EEnv } from "./load-e2e-env";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30000 });
}

async function sitAndSubmit(page: Page, testId: string) {
  await page.goto(`/tests/${testId}/attempt`);
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
  await page.getByTestId("option-A").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByText("Submit the exam?")).toBeVisible();
  await page.getByRole("button", { name: "Submit now" }).click();
  await page.waitForURL(/\/result/, { timeout: 15000 });
}

test.describe("Admin leaderboard expanded student details", () => {
  test("unauthenticated users cannot open the admin results page", async ({
    page,
  }) => {
    const res = await page.goto(
      "/admin/tests/00000000-0000-0000-0000-000000000001/results"
    );
    expect(res?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });

  test("student cannot open admin leaderboard; student board omits email", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 1 });
    try {
      await login(page, fixture.email, fixture.password);
      await sitAndSubmit(page, fixture.testId);

      await expect(page.getByText("Leaderboard")).toBeVisible();
      await expect(page.getByText(fixture.email)).toHaveCount(0);
      await expect(page.getByText("LMS access")).toHaveCount(0);

      await page.goto(`/admin/tests/${fixture.testId}/results`);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("admin sees expanded profile fields with unchanged rank and marks", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(!e2e.adminEmail || !e2e.adminPassword, "admin credentials required");

    const fixture = await provisionExamFixture({ questionCount: 1 });
    try {
      await login(page, fixture.email, fixture.password);
      await sitAndSubmit(page, fixture.testId);
      await expect(page.getByTestId("result-summary").getByText("Score")).toBeVisible();

      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/login/, { timeout: 15000 });

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(`/admin/tests/${fixture.testId}/results`);
      await expect(page.getByRole("heading", { name: /Results/ })).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByTestId("admin-leaderboard")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "College" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Class" })).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "LMS access" })
      ).toBeVisible();

      const row = page.getByTestId("admin-leaderboard-row").first();
      await expect(row).toHaveAttribute("data-rank", "1");
      await expect(row.getByText("E2E Student")).toBeVisible();
      await expect(row.getByText(fixture.email)).toBeVisible();
      await expect(row.getByText("#1")).toBeVisible();
      await expect(row.getByText(/\/ /)).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByTestId("admin-leaderboard")).toBeVisible();
      await expect(row.getByText(fixture.email)).toBeVisible();
    } finally {
      await teardownExamFixture(fixture);
    }
  });
});
