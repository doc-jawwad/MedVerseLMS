import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Free-student shell policy — requires a deployed app that includes
 * Resources + section locks. Staging credentials must be a free
 * (non–live-subscription) student.
 */
test.describe("Free student navigation", () => {
  test("active Resources and Tests; locked Library / Performance hubs", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(
      e2e.target !== "staging",
      "Set E2E_TARGET=staging (deployed build with Resources IA)"
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

    await expect(
      page.getByRole("link", { name: "Resources" }).or(
        page.getByRole("link", { name: /Year MBBS/ })
      )
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Tests" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact Us" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Prof. Session" })).toBeVisible();

    await page.goto("/library");
    await expect(page.getByText(/subscription(?:\s+is)?\s+required/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: "Get Subscription" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse Resources" })
    ).toBeVisible();

    await page.goto("/mcq-bank");
    await expect(page.getByText(/subscription(?:\s+is)?\s+required/i)).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/resources");
    await expect(
      page.getByRole("heading", { name: /Year MBBS|Resources/i })
    ).toBeVisible({ timeout: 15000 });

    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: "Contact Us" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("contact-link-whatsapp-phone")).toBeVisible();
    await expect(page.getByTestId("contact-link-email")).toBeVisible();
    await expect(page.getByTestId("contact-link-instagram")).toBeVisible();
    await expect(page.getByTestId("contact-link-youtube")).toBeVisible();
    await expect(page.getByTestId("contact-link-facebook")).toBeVisible();
    await expect(page.getByTestId("contact-link-nursing")).toBeVisible();
    await expect(page.getByText(/https:\/\/whatsapp\.com\/channel/)).toHaveCount(0);

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
