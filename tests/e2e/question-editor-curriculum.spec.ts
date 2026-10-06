import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
} from "./fixtures";

async function pickNamed(
  page: import("@playwright/test").Page,
  testId: string,
  name: string
) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name, exact: true }).click();
}

test.describe("Question Editor curriculum cascade", () => {
  test("create and edit can select every curriculum level without a full tree", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 1 });

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      await page.goto("/admin/questions/new");
      if (await page.getByRole("heading", { name: "Select a class" }).isVisible()) {
        await page.getByRole("button", { name: /1st Year/i }).click();
        await page.waitForURL(/\/admin\/questions\/new/);
      } else {
        await page.getByTestId("admin-class-selector").click();
        await page.getByRole("option", { name: /1st Year/i }).click();
        await page.goto("/admin/questions/new");
      }

      await expect(page.getByTestId("question-editor-year")).toBeVisible();
      await pickNamed(page, "question-editor-subject", fixture.subjectName);
      await expect(page.getByTestId("question-editor-book")).toBeEnabled({
        timeout: 15_000,
      });
      await pickNamed(page, "question-editor-book", fixture.tag);
      await expect(page.getByTestId("question-editor-chapter")).toBeEnabled({
        timeout: 15_000,
      });
      await pickNamed(page, "question-editor-chapter", fixture.tag);
      await expect(page.getByTestId("question-editor-topic")).toBeEnabled({
        timeout: 15_000,
      });
      await pickNamed(page, "question-editor-topic", fixture.tag);

      const stem = `${fixture.tag} editor cascade stem`;
      await page.getByPlaceholder("Which of the following…").fill(stem);
      await page.getByPlaceholder("Option A").fill("Correct");
      await page.getByPlaceholder("Option B").fill("Wrong 1");
      await page.getByPlaceholder("Option C").fill("Wrong 2");
      await page.getByPlaceholder("Option D").fill("Wrong 3");
      await page.getByRole("button", { name: "Create question" }).click();
      await page.waitForURL(/\/admin\/questions\/[0-9a-f-]{36}/i, {
        timeout: 20_000,
      });

      await expect(page.getByTestId("question-editor-topic")).toContainText(
        fixture.tag
      );
      await expect(page.getByTestId("question-editor-book")).toContainText(
        fixture.tag
      );
      await expect(page.getByPlaceholder("Which of the following…")).toHaveValue(
        stem
      );

      await page.getByPlaceholder("Which of the following…").fill(`${stem} v2`);
      await page.getByRole("button", { name: "Save as new version" }).click();
      await expect(page.getByText(/saved as a new version/i)).toBeVisible({
        timeout: 15_000,
      });

      await page.getByTestId("question-editor-year").click();
      const year2 = page.getByRole("option", { name: "Year 2", exact: true });
      if (await year2.isVisible()) {
        await year2.click();
        await page.getByTestId("question-editor-subject").click();
        await expect(page.getByRole("option").first()).toBeVisible({
          timeout: 10_000,
        });
      }
    } finally {
      await teardownQuestionPoolFixture(fixture);
    }
  });
});
