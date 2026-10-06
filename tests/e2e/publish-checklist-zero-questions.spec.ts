import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftTestForBuilder,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
} from "./fixtures";

/**
 * Zero-question draft: checklist must fail clearly and Publish must stay blocked.
 * Adding one question must clear the question-count failure (other checks may still fail).
 */
test.describe("publish checklist zero questions", () => {
  test("zero-question draft shows actionable failure and blocks publish", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 1 });
    const title = `E2E_ZQ_${Date.now()}`;
    let testId: string | undefined;
    try {
      testId = await createDraftTestForBuilder(fixture, title);
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      await page.goto(`/admin/tests/${testId}`);
      await expect(page.getByText(title)).toBeVisible();

      const questionCountItem = page
        .locator('[data-testid="publish-checklist-item"]')
        .filter({ hasText: /at least one question required/i });
      await expect(questionCountItem).toBeVisible({ timeout: 20_000 });
      await expect(questionCountItem).toHaveAttribute("data-pass", "false");
      await expect(
        questionCountItem.getByTestId("publish-checklist-hint")
      ).toContainText(/add at least one question/i);

      await expect(page.getByTestId("publish-checklist-blocked")).toContainText(
        /at least one question/i
      );
      await expect(page.getByTestId("publish-test-button")).toBeDisabled();

      // Add one valid question — question-count check should pass.
      await page.getByPlaceholder("Search text…").fill(fixture.tag);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const tick = page.getByTestId(`tick-question-${fixture.questionIds[0]}`);
      await expect(tick).toBeVisible({ timeout: 20_000 });
      await tick.click();
      await page.getByTestId("add-selected-questions").click();
      await expect(
        page.locator('[data-testid="publish-checklist-item"][data-pass="true"]')
          .filter({ hasText: /question count/i })
      ).toBeVisible({ timeout: 20_000 });

      // Publish may remain disabled for other checklist items (e.g. audience),
      // but the zero-question block copy must be gone.
      await expect(
        page
          .getByTestId("publish-checklist-blocked")
          .filter({ hasText: /at least one question/i })
      ).toHaveCount(0);
    } finally {
      await teardownQuestionPoolFixture(fixture, { testId });
    }
  });
});
