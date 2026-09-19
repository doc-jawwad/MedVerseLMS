import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Free-student shell policy — requires a deployed app that includes
 * Free Resources + section locks. Staging credentials must be a free
 * (non–live-subscription) student.
 */
test.describe("Free student navigation", () => {
  test("active Free Resources; locked paid hubs; pending ≠ live", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(
      e2e.target !== "staging",
      "Set E2E_TARGET=staging (deployed build with Free Resources)"
    );
    test.skip(
      !e2e.stagingStudentEmail || !e2e.stagingStudentPassword,
      "E2E_STAGING_STUDENT_EMAIL/PASSWORD required"
    );

    await page.goto("/login");
    expect(page.url().startsWith(STAGING_APP_ORIGIN)).toBeTruthy();

    await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
    await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });

    await expect(page.getByRole("link", { name: "Free Resources" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Subscription" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Account" })).toBeVisible();

    // Locked chrome still links to the hub (polished lock page).
    await page.getByRole("link", { name: "Practice MCQs" }).click();
    await page.waitForURL(/\/practice$/, { timeout: 15000 });
    await expect(page.getByText(/subscription required/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: "Get Subscription" })
    ).toBeVisible();

    await page.goto("/free-resources");
    await expect(
      page.getByRole("heading", { name: "Free Resources" })
    ).toBeVisible({ timeout: 15000 });

    await page.goto("/performance");
    await expect(page.getByText(/subscription required/i)).toBeVisible({
      timeout: 15000,
    });
  });
});
