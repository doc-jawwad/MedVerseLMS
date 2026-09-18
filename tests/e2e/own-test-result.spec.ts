import { test, expect, type Page } from "@playwright/test";
import {
  changeStudentYear,
  expireSubscription,
  markTestPaidWithLiveSubscription,
  provisionExamFixture,
  renewSubscription,
  teardownExamFixture,
} from "./fixtures";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

async function sitAndSubmit(page: Page, testId: string) {
  await page.goto(`/tests/${testId}/attempt`);
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
  await page.getByTestId("option-A").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10000 });
  await page.getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByText("Submit the exam?")).toBeVisible();
  await page.getByRole("button", { name: "Submit now" }).click();
  await page.waitForURL(/\/result/, { timeout: 15000 });
  await expect(page.getByText("Your result")).toBeVisible();
  await expect(page.getByTestId("result-summary")).toBeVisible();
}

test.describe("Own historical test result (8J-B)", () => {
  test("result page still loads after year change", async ({ page }) => {
    const fixture = await provisionExamFixture({ questionCount: 2, negativeMark: 0 });
    try {
      await login(page, fixture.email, fixture.password);
      await sitAndSubmit(page, fixture.testId);
      await changeStudentYear(fixture.studentId, 3);
      await page.goto(`/tests/${fixture.testId}/result`);
      await expect(page.getByText("Your result")).toBeVisible();
      await expect(page.getByTestId("result-summary")).toBeVisible();
      await expect(page.getByText("Score")).toBeVisible();
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("expired subscriber still sees score while 8J-A review stays locked; renewal restores review", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 2, negativeMark: 0 });
    let paid: Awaited<ReturnType<typeof markTestPaidWithLiveSubscription>> | null =
      null;
    try {
      paid = await markTestPaidWithLiveSubscription(
        fixture.testId,
        fixture.studentId
      );
      await login(page, fixture.email, fixture.password);
      await sitAndSubmit(page, fixture.testId);
      await expect(page.getByText(/E2E fixture question/)).not.toHaveCount(0);

      await expireSubscription(paid.subscriptionId);
      await page.goto(`/tests/${fixture.testId}/result`);
      await expect(page.getByText("Your result")).toBeVisible();
      await expect(page.getByTestId("result-summary")).toBeVisible();
      await expect(page.getByTestId("result-summary").getByText("Score")).toBeVisible();
      await expect(page.getByTestId("result-summary").getByText("Percentage")).toBeVisible();
      await expect(page.getByTestId("review-locked-entitlement")).toBeVisible();
      await expect(page.getByText(/E2E fixture question/)).toHaveCount(0);

      await renewSubscription(paid.subscriptionId);
      await page.goto(`/tests/${fixture.testId}/result`);
      await expect(page.getByText("Your result")).toBeVisible();
      await expect(page.getByTestId("result-summary")).toBeVisible();
      await expect(page.getByTestId("review-locked-entitlement")).toHaveCount(0);
      await expect(page.getByText(/E2E fixture question/)).not.toHaveCount(0);
    } finally {
      if (paid) await paid.cleanup();
      await teardownExamFixture(fixture);
    }
  });

  test("another student's test id cannot show this student's result", async ({
    page,
  }) => {
    const owner = await provisionExamFixture({ questionCount: 2, negativeMark: 0 });
    const other = await provisionExamFixture({ questionCount: 2, negativeMark: 0 });
    try {
      await login(page, owner.email, owner.password);
      await sitAndSubmit(page, owner.testId);
      await page.goto(`/tests/${other.testId}/result`);
      await expect(page.getByText("Your result")).toHaveCount(0);
      await expect(page.getByTestId("result-summary")).toHaveCount(0);
    } finally {
      await teardownExamFixture(owner);
      await teardownExamFixture(other);
    }
  });
});
