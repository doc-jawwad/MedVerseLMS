import { test, expect, type Page } from "@playwright/test";
import {
  changeStudentYear,
  closeTestNow,
  deletePublishedTest,
  expireSubscription,
  forceAttemptExpiry,
  markTestPaidWithLiveSubscription,
  provisionCompanionPublishedTest,
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

test.describe("Integrated 8J browser lifecycle", () => {
  test("free → subscribe → interrupt → submit → expire → renew → year change", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 2, negativeMark: 0 });
    let paidTestId: string | null = null;
    let sub: Awaited<ReturnType<typeof markTestPaidWithLiveSubscription>> | null =
      null;
    try {
      await login(page, fixture.email, fixture.password);

      // Free paper
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await page.getByTestId("option-A").click();
      await expect(page.getByTestId("save-status")).toHaveText("Saved", {
        timeout: 10000,
      });
      await page.getByRole("button", { name: "Submit exam" }).click();
      await page.getByRole("button", { name: "Submit now" }).click();
      await page.waitForURL(/\/result/, { timeout: 15000 });
      await expect(page.getByText("Your result")).toBeVisible();

      // Subscribe + paid companion paper
      const companion = await provisionCompanionPublishedTest({
        questionCount: 2,
        negativeMark: 0,
      });
      paidTestId = companion.testId;
      sub = await markTestPaidWithLiveSubscription(
        paidTestId,
        fixture.studentId
      );

      await page.goto(`/tests/${paidTestId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await page.getByTestId("option-A").click();
      await expect(page.getByTestId("save-status")).toHaveText("Saved", {
        timeout: 10000,
      });
      await page.getByTestId("option-B").click();
      await expect(page.getByTestId("option-B")).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      await expect(page.getByTestId("save-status")).toHaveText("Saved", {
        timeout: 10000,
      });

      await page.reload();
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("option-B")).toHaveAttribute(
        "aria-pressed",
        "true"
      );

      await page.getByRole("button", { name: "Submit exam" }).click();
      await page.getByRole("button", { name: "Submit now" }).click();
      await page.waitForURL(/\/result/, { timeout: 15000 });
      await expect(page.getByText("Your result")).toBeVisible();
      await expect(page.getByTestId("result-summary")).toBeVisible();
      await expect(page.getByText(/E2E fixture question/)).not.toHaveCount(0);

      await expireSubscription(sub.subscriptionId);
      await page.goto(`/tests/${paidTestId}/result`);
      await expect(page.getByTestId("result-summary").getByText("Score")).toBeVisible();
      await expect(page.getByTestId("result-summary").getByText("Percentage")).toBeVisible();
      await expect(page.getByTestId("review-locked-entitlement")).toBeVisible();
      await expect(page.getByText(/E2E fixture question/)).toHaveCount(0);

      await renewSubscription(sub.subscriptionId);
      await page.goto(`/tests/${paidTestId}/result`);
      await expect(page.getByTestId("review-locked-entitlement")).toHaveCount(0);
      await expect(page.getByText(/E2E fixture question/)).not.toHaveCount(0);

      await changeStudentYear(fixture.studentId, 3);
      await page.goto(`/tests/${paidTestId}/result`);
      await expect(page.getByText("Your result")).toBeVisible();
      await expect(page.getByTestId("result-summary")).toBeVisible();
      await page.goto(`/tests/${fixture.testId}/result`);
      await expect(page.getByText("Your result")).toBeVisible();
    } finally {
      if (sub) await sub.cleanup();
      if (paidTestId) await deletePublishedTest(paidTestId);
      await teardownExamFixture(fixture);
    }
  });

  test("close → expire → lazy finalize → own historical result", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({
      questionCount: 1,
      negativeMark: 0,
      durationMinutes: 60,
    });
    try {
      await login(page, fixture.email, fixture.password);
      await page.goto(`/tests/${fixture.testId}/attempt`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
      await page.getByTestId("option-A").click();
      await expect(page.getByTestId("save-status")).toHaveText("Saved", {
        timeout: 10000,
      });

      await closeTestNow(fixture.testId);
      await forceAttemptExpiry(fixture.testId, fixture.studentId);

      await page.goto(`/tests/${fixture.testId}/attempt`);
      await page.waitForURL(/\/result/, { timeout: 20000 });
      await expect(page.getByText("Your result")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("result-summary")).toBeVisible();

      await page.goto(`/tests/${fixture.testId}/result`);
      await expect(page.getByText("Your result")).toBeVisible();
      await expect(page.getByText("Score")).toBeVisible();
    } finally {
      await teardownExamFixture(fixture);
    }
  });
});
