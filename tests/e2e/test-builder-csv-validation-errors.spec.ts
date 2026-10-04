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
 * Test Builder CSV validation UX: structured row/field/reason errors,
 * Import blocked until fixed; valid CSV still imports.
 */
test.describe("Test Builder CSV validation errors", () => {
  test("invalid CSV shows actionable errors; valid CSV imports", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 1 });
    const testId = await createDraftTestForBuilder(
      fixture,
      `TB CSV ERR ${fixture.tag}`
    );

    const badTag = `${fixture.tag}_BAD`;
    const goodTag = `${fixture.tag}_OK`;
    const badPath = path.join(os.tmpdir(), `${badTag}.csv`);
    const goodPath = path.join(os.tmpdir(), `${goodTag}.csv`);
    const header =
      "question,option_a,option_b,option_c,option_d,option_e,correct,explanation,reference,book,chapter,topic,difficulty,tags";
    fs.writeFileSync(
      badPath,
      [
        header,
        // Row 2: invalid correct
        `${badTag} bad correct,A1,B1,C1,D1,,Z,exp,ref,${badTag},${badTag},${badTag},easy,csv|err`,
        // Row 3: missing option_c
        `${badTag} missing opt,A2,B2,,D2,,A,exp,ref,${badTag},${badTag},${badTag},easy,csv|err`,
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      goodPath,
      [
        header,
        `${goodTag} stem one,A1,B1,C1,D1,,A,exp1,ref1,${goodTag},${goodTag},${goodTag},easy,csv|ok`,
      ].join("\n"),
      "utf8"
    );

    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      await page.goto(`/admin/tests/${testId}`);
      await expect(page.getByText(`TB CSV ERR ${fixture.tag}`)).toBeVisible();

      const csvRoot = page.getByTestId("test-builder-csv-import");
      await expect(csvRoot).toBeVisible();
      await csvRoot.getByTestId("test-builder-csv-file").setInputFiles(badPath);

      const errors = csvRoot.getByTestId("test-builder-csv-errors");
      await expect(errors).toBeVisible({ timeout: 15_000 });
      await expect(csvRoot).toContainText(/2 validation error/i);

      const items = csvRoot.getByTestId("test-builder-csv-error-item");
      expect(await items.count()).toBeGreaterThanOrEqual(2);

      const row2 = csvRoot.locator(
        '[data-testid="test-builder-csv-error-item"][data-row="2"][data-field="correct"]'
      );
      await expect(row2).toBeVisible();
      await expect(row2).toContainText(/Row 2/i);
      await expect(row2).toContainText(/correct/i);
      await expect(row2).toContainText(/Z/);

      const row3 = csvRoot.locator(
        '[data-testid="test-builder-csv-error-item"][data-row="3"][data-field="option_c"]'
      );
      await expect(row3).toBeVisible();
      await expect(row3).toContainText(/Row 3/i);
      await expect(row3).toContainText(/option_c/i);

      await expect(csvRoot.getByTestId("test-builder-csv-commit")).toBeDisabled();
      await expect(
        csvRoot.getByTestId("test-builder-csv-copy-errors")
      ).toBeVisible();

      // Clear and import a valid CSV — existing happy path must still work
      await csvRoot.getByRole("button", { name: "Clear" }).click();
      await csvRoot.getByTestId("test-builder-csv-file").setInputFiles(goodPath);
      await expect(csvRoot.getByText(/1 row\(s\).*valid/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(csvRoot.getByTestId("test-builder-csv-errors")).toHaveCount(0);
      await expect(csvRoot.getByTestId("test-builder-csv-commit")).toBeEnabled();
      await csvRoot.getByTestId("test-builder-csv-commit").click();
      await expect(page.getByTestId("imported-question-set")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("imported-question-set")).toContainText(
        /1 question/
      );

      const relevant = consoleErrors.filter(
        (e) =>
          !/favicon|hydration|Download the React DevTools|Failed to load resource/i.test(
            e
          )
      );
      expect(relevant, JSON.stringify(relevant)).toEqual([]);
    } finally {
      for (const p of [badPath, goodPath]) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
      await teardownQuestionPoolFixture(fixture, { testId });
    }
  });
});
