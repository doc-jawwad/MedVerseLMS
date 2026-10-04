import fs from "fs";
import os from "os";
import path from "path";
import { test, expect, devices } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftTestForBuilder,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
} from "./fixtures";

const HEADER =
  "question,option_a,option_b,option_c,option_d,option_e,correct,explanation,reference,book,chapter,topic,difficulty,tags";

function writeCsv(filePath: string, lines: string[]) {
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

/**
 * Mobile CSV upload reliability: same-file reselect must still parse,
 * import must complete once, invalid CSV stays actionable.
 */
test.describe("Test Builder CSV mobile upload", () => {
  test.use({ ...devices["Pixel 7"] });

  test("mobile: reselect same file, import once, invalid errors actionable", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 1 });
    const testId = await createDraftTestForBuilder(
      fixture,
      `TB CSV MOB ${fixture.tag}`
    );

    const tag = `${fixture.tag}_MOB`;
    const csvPath = path.join(os.tmpdir(), `${tag}.csv`);
    const badPath = path.join(os.tmpdir(), `${tag}-bad.csv`);
    writeCsv(csvPath, [
      HEADER,
      `${tag} stem one,A1,B1,C1,D1,,A,exp1,ref1,${tag},${tag},${tag},easy,m`,
      `${tag} stem two,A2,B2,C2,D2,,B,exp2,ref2,${tag},${tag},${tag},medium,m`,
    ]);
    writeCsv(badPath, [
      HEADER,
      `${tag} bad,A1,B1,C1,D1,,Z,exp,ref,${tag},${tag},${tag},easy,m`,
    ]);

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
      await expect(page.getByText(`TB CSV MOB ${fixture.tag}`)).toBeVisible();

      const csvRoot = page.getByTestId("test-builder-csv-import");
      await expect(csvRoot).toBeVisible();

      const fileInput = csvRoot.getByTestId("test-builder-csv-file");

      // Invalid CSV → actionable errors (existing UX)
      await fileInput.setInputFiles(badPath);
      await expect(csvRoot.getByTestId("test-builder-csv-errors")).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        csvRoot.locator(
          '[data-testid="test-builder-csv-error-item"][data-row="2"][data-field="correct"]'
        )
      ).toContainText(/Row 2/i);
      await expect(csvRoot.getByTestId("test-builder-csv-commit")).toBeDisabled();
      // Proven mobile bug: input must be cleared after parse so same-path reselect works
      await expect
        .poll(async () =>
          fileInput.evaluate((el: HTMLInputElement) => el.files?.length ?? 0)
        )
        .toBe(0);

      // Same-path reselect after fix via Choose CSV (clears, then native picker)
      writeCsv(csvPath, [
        HEADER,
        `${tag} stem one,A1,B1,C1,D1,,A,exp1,ref1,${tag},${tag},${tag},easy,m`,
        `${tag} stem two,A2,B2,C2,D2,,B,exp2,ref2,${tag},${tag},${tag},medium,m`,
      ]);
      const chooser1 = page.waitForEvent("filechooser");
      await csvRoot.getByTestId("test-builder-csv-choose").click();
      await (await chooser1).setFiles(csvPath);
      await expect(csvRoot.getByText(/2 row\(s\).*valid/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(csvRoot).toContainText(path.basename(csvPath));
      await expect
        .poll(async () =>
          fileInput.evaluate((el: HTMLInputElement) => el.files?.length ?? 0)
        )
        .toBe(0);

      // Reselect the exact same path again — must still recognize
      const chooser2 = page.waitForEvent("filechooser");
      await csvRoot.getByTestId("test-builder-csv-choose").click();
      await (await chooser2).setFiles(csvPath);
      await expect(csvRoot.getByText(/2 row\(s\).*valid/i)).toBeVisible({
        timeout: 15_000,
      });

      const commit = csvRoot.getByTestId("test-builder-csv-commit");
      await expect(commit).toBeEnabled();

      // Double-tap must not create two batches
      await commit.click();
      await commit.click({ force: true }).catch(() => {});
      await expect(page.getByTestId("imported-question-set")).toBeVisible({
        timeout: 45_000,
      });
      await expect(page.getByTestId("imported-question-set")).toContainText(
        /2 question/
      );

      // Batch selection still works
      await page.getByTestId("select-imported-set").click();
      await expect(page.getByText("2 selected")).toBeVisible();
      await page.getByTestId("add-selected-questions").click();
      await expect(page.getByText("Questions (2)")).toBeVisible({
        timeout: 15_000,
      });

      const relevant = consoleErrors.filter(
        (e) =>
          !/favicon|hydration|Download the React DevTools|Failed to load resource/i.test(
            e
          )
      );
      expect(relevant, JSON.stringify(relevant)).toEqual([]);
    } finally {
      for (const p of [csvPath, badPath]) {
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

test.describe("Test Builder CSV desktop smoke", () => {
  test("desktop: valid CSV import still works", async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 1 });
    const testId = await createDraftTestForBuilder(
      fixture,
      `TB CSV DESK ${fixture.tag}`
    );
    const tag = `${fixture.tag}_DESK`;
    const csvPath = path.join(os.tmpdir(), `${tag}.csv`);
    writeCsv(csvPath, [
      HEADER,
      `${tag} stem,A1,B1,C1,D1,,A,exp,ref,${tag},${tag},${tag},easy,d`,
    ]);

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      await page.goto(`/admin/tests/${testId}`);
      const csvRoot = page.getByTestId("test-builder-csv-import");
      await csvRoot.getByTestId("test-builder-csv-file").setInputFiles(csvPath);
      await expect(csvRoot.getByText(/1 row\(s\).*valid/i)).toBeVisible({
        timeout: 15_000,
      });
      await csvRoot.getByTestId("test-builder-csv-commit").click();
      await expect(page.getByTestId("imported-question-set")).toBeVisible({
        timeout: 45_000,
      });
      await expect(page.getByTestId("imported-question-set")).toContainText(
        /1 question/
      );
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
