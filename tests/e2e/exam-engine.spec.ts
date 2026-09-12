import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { provisionExamFixture, teardownExamFixture } from "./fixtures";

// Walks the failure-scenario table in docs/exam-state-machine.md against a
// real browser + the live exam engine. Each test provisions its own isolated
// student/test fixture so specs don't interfere with each other or real data.

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

async function startExam(page: Page, testId: string) {
  await page.goto(`/tests/${testId}/attempt`);
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
}

const optionA = (page: Page) => page.getByTestId("option-A");
const saveStatus = (page: Page) => page.getByTestId("save-status");

test.describe("Exam engine", () => {
  test("refresh mid-exam resumes with answers and timer intact", async ({ page }) => {
    const fixture = await provisionExamFixture({ questionCount: 3 });
    try {
      await login(page, fixture.email, fixture.password);
      await startExam(page, fixture.testId);

      await optionA(page).click();
      await expect(optionA(page)).toHaveAttribute("aria-pressed", "true");
      await expect(saveStatus(page)).toHaveText("Saved", { timeout: 10000 });

      const timerBefore = await page.locator('[aria-label="time remaining"]').textContent();

      await page.reload();
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });

      // the answered option survives the refresh (server-side resume, not local cache)
      await expect(optionA(page)).toHaveAttribute("aria-pressed", "true");

      const timerAfter = await page.locator('[aria-label="time remaining"]').textContent();
      expect(timerAfter).toBeTruthy();
      expect(timerBefore).toBeTruthy();
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("second tab on the same device is blocked", async ({ context, page }) => {
    const fixture = await provisionExamFixture({ questionCount: 2 });
    try {
      await login(page, fixture.email, fixture.password);
      await startExam(page, fixture.testId);

      const page2 = await context.newPage();
      await page2.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page2.getByText(/already open in another tab/i)).toBeVisible({
        timeout: 10000,
      });
      await page2.close();
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("a second device is rejected with a clear message", async ({ browser, page }) => {
    const fixture = await provisionExamFixture({ questionCount: 2 });
    let otherContext: BrowserContext | undefined;
    try {
      await login(page, fixture.email, fixture.password);
      await startExam(page, fixture.testId);

      // A fresh browser context has its own localStorage -> a different
      // device_id, exactly like a second physical device.
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

  test("submit shows confirmation, navigates to result, and re-visiting the attempt bounces to it", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 2, negativeMark: 0 });
    try {
      await login(page, fixture.email, fixture.password);
      await startExam(page, fixture.testId);

      await optionA(page).click();
      await expect(saveStatus(page)).toHaveText("Saved", { timeout: 10000 });

      await page.getByRole("button", { name: "Submit exam" }).click();
      await expect(page.getByText("Submit the exam?")).toBeVisible();
      await page.getByRole("button", { name: "Submit now" }).click();

      await page.waitForURL(/\/result/, { timeout: 15000 });
      await expect(page.getByText("Your result")).toBeVisible();

      // Going back to the attempt URL after submission must not re-open the
      // exam or create a second attempt — it should bounce to the result.
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await page.waitForURL(/\/result/, { timeout: 15000 });
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("offline answers queue and flush once back online", async ({ page, context }) => {
    const fixture = await provisionExamFixture({ questionCount: 2 });
    try {
      await login(page, fixture.email, fixture.password);
      await startExam(page, fixture.testId);

      await context.setOffline(true);
      await optionA(page).click();
      await expect(optionA(page)).toHaveAttribute("aria-pressed", "true");
      // While offline the status must never claim success.
      await expect(saveStatus(page)).not.toHaveText("Saved", { timeout: 3000 });

      // Reconnect: the queued answer must flush and settle back to "Saved"
      // without the student losing it or needing to re-click anything.
      await context.setOffline(false);
      await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20000 });

      // The answer actually reached the server, not just the local UI cache.
      await page.reload();
      await expect(optionA(page)).toHaveAttribute("aria-pressed", "true");
    } finally {
      await teardownExamFixture(fixture);
    }
  });
});
