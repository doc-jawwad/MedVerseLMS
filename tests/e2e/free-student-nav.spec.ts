import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Free-student shell policy — unified Academic tree + locked Prof. Session.
 * Staging credentials must be a free (non–live-subscription) student.
 */
test.describe("Free student navigation", () => {
  test("all years navigable; Prof. Session and Performance locked", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(
      e2e.target !== "staging",
      "Set E2E_TARGET=staging (deployed build with Academic IA)"
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

    await expect(page.getByRole("link", { name: "1st Year MBBS" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Final Year MBBS" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tests" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact Us" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Prof. Session" })).toBeVisible();
    await expect(page.getByRole("link", { name: "MCQ Bank" })).toHaveCount(0);

    await page.goto("/academic");
    await expect(page.getByRole("heading", { name: "Academic" })).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/academic/year/1");
    await expect(page.getByRole("heading", { name: "1st Year MBBS" })).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/academic/prof-session");
    await expect(page.getByText(/subscription(?:\s+is)?\s+required/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: "Get Subscription" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse Academic" })
    ).toBeVisible();

    await page.goto("/mcq-bank");
    await expect(page.getByText(/subscription(?:\s+is)?\s+required/i)).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: "Contact Us" })).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/tests");
    await expect(page.getByRole("heading", { name: "Tests" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/subscription(?:\s+is)?\s+required/i)).toHaveCount(0);

    await page.goto("/performance");
    await expect(page.getByText(/subscription(?:\s+is)?\s+required/i)).toBeVisible({
      timeout: 15000,
    });
  });
});
