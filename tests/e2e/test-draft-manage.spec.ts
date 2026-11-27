import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftTestForBuilder,
  deletePublishedTest,
  provisionQuestionPoolFixture,
  publishDraftTestViaRpc,
  teardownQuestionPoolFixture,
} from "./fixtures";

// Draft Edit + Delete on the Tests list / builder. Isolated fixture; tears down
// leftover rows created here.

/**
 * Published sibling via publish_test (#38: a direct status PATCH is rejected
 * by the lifecycle guard). Uses its own one-question pool so the draft under
 * test keeps the main pool to itself.
 */
async function markTestPublished(testId: string) {
  const siblingPool = await provisionQuestionPoolFixture({ questionCount: 1 });
  await publishDraftTestViaRpc(siblingPool, testId, siblingPool.questionIds[0]);
}

test.describe("Test draft management — Edit + Delete", () => {
  test("draft shows Edit/Delete; edit persists; delete removes draft only", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 2 });
    const draftTitle = `Draft Mgmt ${fixture.tag}`;
    const publishedTitle = `Published Keep ${fixture.tag}`;
    const draftId = await createDraftTestForBuilder(fixture, draftTitle);
    const publishedId = await createDraftTestForBuilder(fixture, publishedTitle);
    await markTestPublished(publishedId);

    let deletedViaUi = false;
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      // Class-scoped list — fixture drafts are Year 1.
      await page.goto("/admin/tests");
      if (await page.getByRole("heading", { name: "Select a class" }).isVisible()) {
        await page.getByRole("button", { name: /1st Year/i }).click();
        await page.waitForURL(/\/admin\/tests/);
      } else {
        await page.getByTestId("admin-class-selector").click();
        await page.getByRole("option", { name: /1st Year/i }).click();
        await page.waitForURL(/year=/);
        await page.goto("/admin/tests");
      }

      // --- list: draft shows Edit + Delete; published does not ---
      const draftRow = page.getByTestId(`test-row-${draftId}`);
      await expect(draftRow).toBeVisible({ timeout: 15000 });
      const draftEdit = draftRow
        .getByTestId(`edit-draft-test-${draftId}`)
        .filter({ visible: true });
      const draftDelete = draftRow
        .getByTestId(`delete-draft-test-${draftId}`)
        .filter({ visible: true });
      await expect(draftEdit).toBeVisible();
      await expect(draftDelete).toBeVisible();

      const publishedRow = page.getByTestId(`test-row-${publishedId}`);
      await expect(publishedRow).toBeVisible();
      await expect(
        publishedRow.getByTestId(`delete-draft-test-${publishedId}`).filter({ visible: true })
      ).toHaveCount(0);
      await expect(
        publishedRow.getByTestId(`edit-draft-test-${publishedId}`).filter({ visible: true })
      ).toHaveCount(0);

      // --- Edit opens existing builder ---
      await draftEdit.click();
      await page.waitForURL(new RegExp(`/admin/tests/${draftId}`));
      await expect(page.getByRole("heading", { name: draftTitle })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save config" })).toBeVisible();

      // --- Harmless config update persists ---
      const editedTitle = `${draftTitle} edited`;
      const titleInput = page.getByPlaceholder("Pathology Weekly Test #04");
      await titleInput.fill(editedTitle);
      await page.getByRole("button", { name: "Save config" }).click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15000,
      });
      await page.reload();
      await expect(titleInput).toHaveValue(editedTitle);

      // Attach one question so composition exists before delete
      await page.getByPlaceholder("Search text…").fill(fixture.tag);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        page.getByTestId(`tick-question-${fixture.questionIds[0]}`)
      ).toBeVisible({ timeout: 15000 });
      await page.getByTestId(`tick-question-${fixture.questionIds[0]}`).click();
      await page.getByTestId("add-selected-questions").click();
      await expect(page.getByText("Questions (1)")).toBeVisible({ timeout: 15000 });

      // --- Delete from list ---
      await page.goto("/admin/tests");
      if (await page.getByRole("heading", { name: "Select a class" }).isVisible()) {
        await page.getByRole("button", { name: /1st Year/i }).click();
        await page.waitForURL(/\/admin\/tests/);
      }
      const draftRowAgain = page.getByTestId(`test-row-${draftId}`);
      const draftDeleteAgain = draftRowAgain
        .getByTestId(`delete-draft-test-${draftId}`)
        .filter({ visible: true });
      await expect(draftDeleteAgain).toBeVisible({ timeout: 15000 });
      await draftDeleteAgain.click();
      await expect(page.getByText("Delete this draft test?")).toBeVisible();
      await page
        .getByTestId(`confirm-delete-draft-test-${draftId}`)
        .filter({ visible: true })
        .click();
      await expect(page.getByTestId(`test-row-${draftId}`)).toHaveCount(0, {
        timeout: 15000,
      });
      deletedViaUi = true;

      // Published sibling still listed
      await expect(page.getByTestId(`test-row-${publishedId}`)).toBeVisible();
      await expect(page.getByText(publishedTitle)).toBeVisible();
    } finally {
      if (!deletedViaUi) {
        await teardownQuestionPoolFixture(fixture, { testId: draftId });
      } else {
        await teardownQuestionPoolFixture(fixture);
      }
      await deletePublishedTest(publishedId);
    }
  });
});
