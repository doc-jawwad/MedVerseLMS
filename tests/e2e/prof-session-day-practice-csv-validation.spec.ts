import fs from "fs";
import os from "os";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftProfSessionDay,
  softDeleteProfSessionDayForE2e,
} from "./fixtures";

/**
 * Prof. Session Day Practice CSV validation UX — same structured
 * row/field/reason presentation as Test Builder. Import blocked until fixed;
 * valid CSV still imports and attaches to the day.
 */
test.describe("Prof Session day-practice CSV validation errors", () => {
  test("invalid CSV shows actionable errors; valid CSV imports", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = `PSCSV_${Math.random().toString(36).slice(2, 10)}`;
    const { dayId } = await createDraftProfSessionDay(`Day CSV UX ${tag}`);

    const badTag = `${tag}_BAD`;
    const goodTag = `${tag}_OK`;
    const badPath = path.join(os.tmpdir(), `${badTag}.csv`);
    const goodPath = path.join(os.tmpdir(), `${goodTag}.csv`);
    const header =
      "question,option_a,option_b,option_c,option_d,option_e,correct,explanation,reference,book,chapter,topic,difficulty,tags";
    fs.writeFileSync(
      badPath,
      [
        header,
        `${badTag} bad correct,A1,B1,C1,D1,,Z,exp,ref,${badTag},${badTag},${badTag},easy,csv|err`,
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

      await page.goto(`/admin/prof-session/${dayId}`);
      await expect(page.getByText(`Day CSV UX ${tag}`)).toBeVisible({
        timeout: 20_000,
      });

      await page.getByTestId("day-practice-mode-csv").click();
      const csvRoot = page.getByTestId("day-practice-csv-import");
      await expect(csvRoot).toBeVisible();

      const beforeCount = await page
        .getByTestId("day-practice-selected-count")
        .innerText();

      await csvRoot.getByTestId("day-practice-csv-file").setInputFiles(badPath);

      const errors = csvRoot.getByTestId("day-practice-csv-errors");
      await expect(errors).toBeVisible({ timeout: 15_000 });
      await expect(csvRoot).toContainText(/2 validation error/i);

      const items = csvRoot.getByTestId("day-practice-csv-error-item");
      expect(await items.count()).toBeGreaterThanOrEqual(2);

      const row2 = csvRoot.locator(
        '[data-testid="day-practice-csv-error-item"][data-row="2"][data-field="correct"]'
      );
      await expect(row2).toBeVisible();
      await expect(row2).toContainText(/Row 2/i);
      await expect(row2).toContainText(/correct/i);
      await expect(row2).toContainText(/Z/);

      const row3 = csvRoot.locator(
        '[data-testid="day-practice-csv-error-item"][data-row="3"][data-field="option_c"]'
      );
      await expect(row3).toBeVisible();
      await expect(row3).toContainText(/Row 3/i);
      await expect(row3).toContainText(/option_c/i);

      await expect(
        csvRoot.getByTestId("day-practice-csv-commit")
      ).toBeDisabled();
      await expect(
        csvRoot.getByTestId("day-practice-csv-copy-errors")
      ).toBeVisible();

      // Invalid import must not attach anything
      await expect(page.getByTestId("day-practice-selected-count")).toHaveText(
        beforeCount
      );

      await csvRoot.getByRole("button", { name: "Clear" }).click();
      await csvRoot.getByTestId("day-practice-csv-file").setInputFiles(goodPath);
      await expect(csvRoot.getByText(/1 row\(s\).*valid/i)).toBeVisible({
        timeout: 15_000,
      });
      await expect(csvRoot.getByTestId("day-practice-csv-errors")).toHaveCount(
        0
      );
      await expect(
        csvRoot.getByTestId("day-practice-csv-commit")
      ).toBeEnabled();
      await csvRoot.getByTestId("day-practice-csv-commit").click();

      await expect(page.getByTestId("day-practice-selected-count")).toContainText(
        /Selected:\s*1/,
        { timeout: 30_000 }
      );
      await expect(page.getByText(new RegExp(goodTag))).toBeVisible({
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
      for (const p of [badPath, goodPath]) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
      try {
        await softDeleteProfSessionDayForE2e(dayId);
      } catch {
        /* best-effort cleanup */
      }
    }
  });
});
