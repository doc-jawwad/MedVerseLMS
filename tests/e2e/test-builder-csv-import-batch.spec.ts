import fs from "fs";
import os from "os";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftTestForBuilder,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
} from "./fixtures";

/**
 * Test Creation CSV import → selectable imported set.
 * Isolated fixtures; draft test deleted in teardown. Tagged bank rows remain
 * (same structural limit as other Test Builder e2e fixtures).
 */
test.describe("Test Builder CSV import batch", () => {
  test("import CSV set, select/add set, keep manual ticks, no dupes", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 2 });
    const testId = await createDraftTestForBuilder(
      fixture,
      `TB CSV ${fixture.tag}`
    );

    const csvTag = `${fixture.tag}_CSV`;
    const csvPath = path.join(os.tmpdir(), `${csvTag}.csv`);
    const csvBody = [
      "question,option_a,option_b,option_c,option_d,option_e,correct,explanation,reference,book,chapter,topic,difficulty,tags",
      `${csvTag} stem one,A1,B1,C1,D1,,A,exp1,ref1,${csvTag},${csvTag},${csvTag},easy,csv|batch`,
      `${csvTag} stem two,A2,B2,C2,D2,,B,exp2,ref2,${csvTag},${csvTag},${csvTag},medium,csv|batch`,
      `${csvTag} stem three,A3,B3,C3,D3,,C,exp3,ref3,${csvTag},${csvTag},${csvTag},hard,csv|batch`,
    ].join("\n");
    fs.writeFileSync(csvPath, csvBody, "utf8");

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      await page.goto(`/admin/tests/${testId}`);
      await expect(page.getByText(`TB CSV ${fixture.tag}`)).toBeVisible();

      const csvRoot = page.getByTestId("test-builder-csv-import");
      await expect(csvRoot).toBeVisible();
      await csvRoot.getByTestId("test-builder-csv-file").setInputFiles(csvPath);
      await expect(page.getByText(/3 row\(s\).*valid/i)).toBeVisible({
        timeout: 15_000,
      });
      await csvRoot.getByTestId("test-builder-csv-commit").click();

      const imported = page.getByTestId("imported-question-set");
      await expect(imported).toBeVisible({ timeout: 30_000 });
      await expect(imported).toContainText(/3 question/);

      // Select imported set → ticks only those in the scoped pool
      await page.getByTestId("select-imported-set").click();
      await expect(page.getByText("3 selected")).toBeVisible();
      await page.getByTestId("add-selected-questions").click();
      await expect(page.getByText("Questions (3)")).toBeVisible({
        timeout: 15_000,
      });

      // Idempotent: imported set is already on the test — Add disabled / no dupes
      await expect(imported).toContainText(/already on this test/i);
      await expect(page.getByTestId("add-imported-set")).toBeDisabled();
      await expect(page.getByText("Questions (3)")).toBeVisible();

      // Manual individual selection still works (outside imported set)
      await page.getByTestId("clear-import-batch-filter").click();
      await page.getByPlaceholder("Search text…").fill(fixture.tag);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        page.getByTestId(`tick-question-${fixture.questionIds[0]}`)
      ).toBeVisible({ timeout: 15_000 });
      await page
        .getByTestId(`tick-question-${fixture.questionIds[0]}`)
        .click();
      await page.getByTestId("add-selected-questions").click();
      await expect(page.getByText("Questions (4)")).toBeVisible({
        timeout: 15_000,
      });

      // Imported stems + one manually selected fixture question; sibling
      // fixture question must remain off the test (still tickable in pool).
      await expect(page.getByText(`${csvTag} stem one`)).toBeVisible();
      await expect(page.getByText(`${csvTag} stem two`)).toBeVisible();
      await expect(page.getByText(`${csvTag} stem three`)).toBeVisible();
      await expect(
        page.getByText(`${fixture.tag} builder fixture question 1`)
      ).toBeVisible();
      await expect(
        page.getByTestId(`tick-question-${fixture.questionIds[1]}`)
      ).toBeVisible();
      await expect(page.getByText("Questions (4)")).toBeVisible();
    } finally {
      try {
        fs.unlinkSync(csvPath);
      } catch {
        /* ignore */
      }
      await teardownQuestionPoolFixture(fixture, { testId });
    }
  });
});
