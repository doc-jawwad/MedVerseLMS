import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  closeTestNow,
  deleteStudent,
  forceAttemptExpiry,
  provisionEnrolledStudent,
  provisionExamFixture,
  teardownExamFixture,
} from "./fixtures";
import { isNearHourRemaining, NEAR_HOUR_REMAINING } from "./timer-assert";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe("Close test now clamp (8J-C)", () => {
  test("open tab timer moves earlier after save without reload (8J-D)", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 2, durationMinutes: 60 });
    try {
      await login(page, fixture.email, fixture.password);
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });

      const timerBefore = await page.locator('[aria-label="time remaining"]').textContent();
      expect(isNearHourRemaining(timerBefore)).toBe(true);

      await closeTestNow(fixture.testId);

      await page.getByTestId("option-A").click();
      await expect(page.getByTestId("save-status")).toHaveText("Saved", {
        timeout: 10000,
      });

      await expect
        .poll(async () => page.locator('[aria-label="time remaining"]').textContent(), {
          timeout: 10000,
        })
        .not.toMatch(NEAR_HOUR_REMAINING);
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("student can save after close; reload resumes with earlier server deadline", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 2, durationMinutes: 60 });
    try {
      await login(page, fixture.email, fixture.password);
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await page.getByTestId("option-A").click();
      await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10000 });

      const timerBefore = await page.locator('[aria-label="time remaining"]').textContent();

      await closeTestNow(fixture.testId);

      await page.getByRole("button", { name: "Next →" }).click();
      await page.getByTestId("option-A").click();
      await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10000 });

      await page.reload();
      // Resume must not show a false already-submitted blocker with no row.
      // Clamped deadline is ~now, so the client may auto-submit on remount.
      await expect
        .poll(async () => page.url(), { timeout: 20000 })
        .toMatch(/\/(attempt|result)/);

      if (page.url().includes("/result")) {
        await expect(page.getByText("Your result")).toBeVisible({ timeout: 15000 });
      } else {
        await expect(page.getByText(/Question 1 of|Your result|Test not open/)).toBeVisible({
          timeout: 15000,
        });
        if (await page.getByText(/Question 1 of/).isVisible()) {
          const timerAfter = await page.locator('[aria-label="time remaining"]').textContent();
          expect(timerAfter).toBeTruthy();
          expect(isNearHourRemaining(timerBefore)).toBe(true);
          expect(isNearHourRemaining(timerAfter)).toBe(false);
        }
      }
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("another student cannot start a closed test", async ({ browser, page }) => {
    const fixture = await provisionExamFixture({ questionCount: 1, durationMinutes: 60 });
    const other = await provisionEnrolledStudent();
    let otherContext: BrowserContext | undefined;
    try {
      await login(page, fixture.email, fixture.password);
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await closeTestNow(fixture.testId);

      otherContext = await browser.newContext();
      const page2 = await otherContext.newPage();
      await login(page2, other.email, other.password);
      await page2.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page2.getByText(/Test not open/i)).toBeVisible({ timeout: 15000 });
    } finally {
      await otherContext?.close();
      await deleteStudent(other.studentId);
      await teardownExamFixture(fixture);
    }
  });

  test("other device takeover stays blocked after close", async ({ browser, page }) => {
    const fixture = await provisionExamFixture({ questionCount: 1, durationMinutes: 60 });
    let otherContext: BrowserContext | undefined;
    try {
      await login(page, fixture.email, fixture.password);
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await closeTestNow(fixture.testId);

      otherContext = await browser.newContext();
      const page2 = await otherContext.newPage();
      await login(page2, fixture.email, fixture.password);
      await page2.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page2.getByText(/open on another device/i)).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await otherContext?.close();
      await teardownExamFixture(fixture);
    }
  });

  test("expired closed attempt finalizes to a real result, not a false already_submitted empty state", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 1, negativeMark: 0 });
    try {
      await login(page, fixture.email, fixture.password);
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await closeTestNow(fixture.testId);
      await forceAttemptExpiry(fixture.testId, fixture.studentId);

      await page.goto(`/tests/${fixture.testId}/attempt`);
      await page.waitForURL(/\/result/, { timeout: 15000 });
      await expect(page.getByText("Your result")).toBeVisible();
    } finally {
      await teardownExamFixture(fixture);
    }
  });
});
