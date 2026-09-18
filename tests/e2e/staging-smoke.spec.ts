import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Staging smoke — confirms the browser is on staging before stateful suites.
 * Requires E2E_TARGET=staging and E2E_STAGING_STUDENT_* credentials.
 */
test.describe("Staging smoke", () => {
  test("login → dashboard on staging origin → sign out", async ({ page }) => {
    const e2e = loadE2EEnv();
    test.skip(
      e2e.target !== "staging",
      "Set E2E_TARGET=staging to run staging smoke"
    );
    test.skip(
      !e2e.stagingStudentEmail || !e2e.stagingStudentPassword,
      "E2E_STAGING_STUDENT_EMAIL/PASSWORD required"
    );

    await page.goto("/login");
    expect(page.url().startsWith(STAGING_APP_ORIGIN)).toBeTruthy();
    expect(page.url()).toContain("staging.medversepk.com");
    expect(page.url()).not.toContain("lms.medversepk.com");
    expect(page.url()).not.toContain("localhost");

    await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
    await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });

    expect(page.url().startsWith(`${STAGING_APP_ORIGIN}/dashboard`)).toBeTruthy();
    await expect(page.getByRole("heading", { name: /Welcome/i })).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    expect(page.url()).toContain("staging.medversepk.com/login");
  });
});
