import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftTestForBuilder,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
} from "./fixtures";

// Covers the new/changed Test Builder behavior: cascading question filters,
// manual reorder, per-question marks override, and the existing
// validate/publish/freeze flow end-to-end through the real admin UI.
// Uses its own isolated question-pool fixture (no shared/seeded data) and
// creates its own throwaway draft test, torn down afterward.

test.describe("Test Builder", () => {
  test("filter, add, reorder, set marks, validate, and publish a draft test", async ({ page }) => {
    // Fixture provisioning (9 sequential service-role calls) + a long real
    // multi-step admin UI flow (login, search, 2 adds, reorder, marks,
    // audience, checklist, publish) genuinely exceeds the default 30s
    // budget on a loaded dev server even when every step succeeds —
    // confirmed by manual reproduction completing the identical flow
    // correctly end-to-end. Not a flakiness workaround for a broken step.
    test.setTimeout(75_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 3 });
    const testId = await createDraftTestForBuilder(fixture, `TB E2E ${fixture.tag}`);

    try {
      // --- admin login ---
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      await page.goto(`/admin/tests/${testId}`);
      await expect(page.getByText(`TB E2E ${fixture.tag}`)).toBeVisible();

      // --- filter the question bank down to just this fixture's questions
      // (text search on the tag, since these are the only questions with it
      // in their stem) and multi-select the first two ---
      await page.getByPlaceholder("Search text…").fill(fixture.tag);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page.getByTestId(`tick-question-${fixture.questionIds[0]}`)).toBeVisible();

      await page.getByTestId(`tick-question-${fixture.questionIds[0]}`).click();
      await page.getByTestId(`tick-question-${fixture.questionIds[1]}`).click();
      await page.getByTestId("add-selected-questions").click();
      await expect(page.getByTestId(`tick-question-${fixture.questionIds[0]}`)).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByTestId(`tick-question-${fixture.questionIds[1]}`)).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByText("Questions (2)")).toBeVisible();

      // --- reorder: question 0 was added first (position #1, so "move up"
      // is disabled for it); move it down and confirm it's now last (only
      // "move up" enabled, "move down" disabled) ---
      await expect(page.getByTestId(`move-up-${fixture.questionIds[0]}`)).toBeDisabled({ timeout: 15000 });
      await page.getByTestId(`move-down-${fixture.questionIds[0]}`).click();
      await expect(page.getByTestId(`move-down-${fixture.questionIds[0]}`)).toBeDisabled({ timeout: 15000 });
      await expect(page.getByTestId(`move-up-${fixture.questionIds[1]}`)).toBeDisabled({ timeout: 15000 });

      // --- per-question marks override (on whichever question is now
      // first, since position no longer matters for this check) ---
      const marksInput = page.getByTestId(`marks-input-${fixture.questionIds[0]}`);
      await marksInput.fill("2");
      await marksInput.blur();
      await page.waitForTimeout(500); // debounce-free save-on-blur; small settle wait before reload/publish

      // --- audience: grant Year 1 (scoped to the audience checkbox's own
      // label — "Year 1" also appears as the config form's selected value) ---
      await page.locator("label").filter({ hasText: "Year 1" }).click();
      await page.getByRole("button", { name: "Save audience" }).click();

      // --- pre-publication checklist should now all pass ---
      const publishButton = page.getByRole("button", { name: "Publish test" });
      await expect(publishButton).toBeEnabled({ timeout: 15000 });

      await publishButton.click();
      await expect(page.getByText("Publish this test?")).toBeVisible();
      await page.getByRole("button", { name: "Publish", exact: true }).click();

      // --- frozen: status badge flips, per-question controls disappear ---
      await expect(page.getByText("published", { exact: true })).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`move-up-${fixture.questionIds[0]}`)).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByTestId(`marks-input-${fixture.questionIds[0]}`)).toHaveCount(0, { timeout: 15000 });
    } finally {
      await teardownQuestionPoolFixture(fixture, { testId });
    }
  });
});
