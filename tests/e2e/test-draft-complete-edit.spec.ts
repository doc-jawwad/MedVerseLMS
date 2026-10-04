import fs from "fs";
import os from "os";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftTestForBuilder,
  deletePublishedTest,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
} from "./fixtures";
import { isJwtSecret, loadE2EEnv } from "./load-e2e-env";

/**
 * Full draft composition journey: bank add, CSV add, reorder, content edit
 * via create_question_version, leave/reopen, remove without bank delete.
 * Isolated fixtures; draft (+ optional published sibling) torn down.
 */

async function markTestPublished(testId: string) {
  const e2e = loadE2EEnv();
  const rest = e2e.restUrl.replace(/\/$/, "");
  let bearer = e2e.serviceRoleKey;
  if (!isJwtSecret(bearer)) {
    const auth = e2e.authUrl.replace(/\/$/, "");
    const tok = await fetch(`${auth}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: e2e.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: e2e.adminEmail,
        password: e2e.adminPassword,
      }),
    }).then((r) => r.json());
    bearer = tok.access_token;
    if (!bearer) throw new Error(`admin token failed: ${JSON.stringify(tok)}`);
  }
  const patch = await fetch(`${rest}/rest/v1/tests?id=eq.${testId}`, {
    method: "PATCH",
    headers: {
      apikey: e2e.anonKey,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status: "published" }),
  });
  if (!patch.ok) {
    throw new Error(`mark published failed: ${patch.status} ${await patch.text()}`);
  }
}

async function questionStillExists(questionId: string): Promise<boolean> {
  const e2e = loadE2EEnv();
  const rest = e2e.restUrl.replace(/\/$/, "");
  let bearer = e2e.serviceRoleKey;
  if (!isJwtSecret(bearer)) {
    const auth = e2e.authUrl.replace(/\/$/, "");
    const tok = await fetch(`${auth}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: e2e.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: e2e.adminEmail,
        password: e2e.adminPassword,
      }),
    }).then((r) => r.json());
    bearer = tok.access_token;
  }
  const res = await fetch(
    `${rest}/rest/v1/questions?id=eq.${questionId}&select=id`,
    {
      headers: {
        apikey: e2e.anonKey,
        Authorization: `Bearer ${bearer}`,
      },
    }
  ).then((r) => r.json());
  return Array.isArray(res) && res.length === 1;
}

test.describe("Test draft — complete editing before conduct", () => {
  test("compose, CSV, reorder, version-edit, reopen, remove without bank delete", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 2 });
    const draftTitle = `Draft Complete ${fixture.tag}`;
    const publishedTitle = `Published Keep ${fixture.tag}`;
    const draftId = await createDraftTestForBuilder(fixture, draftTitle);
    const publishedId = await createDraftTestForBuilder(fixture, publishedTitle);
    await markTestPublished(publishedId);

    const csvTag = `${fixture.tag}_CSV`;
    const csvPath = path.join(os.tmpdir(), `${csvTag}.csv`);
    fs.writeFileSync(
      csvPath,
      [
        "question,option_a,option_b,option_c,option_d,option_e,correct,explanation,reference,book,chapter,topic,difficulty,tags",
        `${csvTag} stem one,A1,B1,C1,D1,,A,exp1,ref1,${csvTag},${csvTag},${csvTag},easy,csv`,
        `${csvTag} stem two,A2,B2,C2,D2,,B,exp2,ref2,${csvTag},${csvTag},${csvTag},medium,csv`,
      ].join("\n"),
      "utf8"
    );

    const editedStem = `${fixture.tag} EDITED STEM`;
    const editedExplanation = `${fixture.tag} EDITED EXPL`;
    let removedQuestionId: string | null = null;

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      // --- open existing draft builder ---
      await page.goto(`/admin/tests/${draftId}`);
      await expect(page.getByRole("heading", { name: draftTitle })).toBeVisible();

      // 1) Add MCQ manually from bank
      await page.getByPlaceholder("Search text…").fill(fixture.tag);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        page.getByTestId(`tick-question-${fixture.questionIds[0]}`)
      ).toBeVisible({ timeout: 15000 });
      await page.getByTestId(`tick-question-${fixture.questionIds[0]}`).click();
      await page.getByTestId("add-selected-questions").click();
      await expect(page.getByText("Questions (1)")).toBeVisible({ timeout: 15000 });

      // 2) CSV import into existing draft + add set (no duplicate rows)
      const csvRoot = page.getByTestId("test-builder-csv-import");
      await expect(csvRoot).toBeVisible();
      await csvRoot.getByTestId("test-builder-csv-file").setInputFiles(csvPath);
      await expect(page.getByText(/2 row\(s\).*valid/i)).toBeVisible({
        timeout: 15_000,
      });
      await csvRoot.getByTestId("test-builder-csv-commit").click();
      const imported = page.getByTestId("imported-question-set");
      await expect(imported).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("add-imported-set").click();
      await expect(page.getByText("Questions (3)")).toBeVisible({ timeout: 20_000 });
      await expect(imported).toContainText(/already on this test/i);
      await expect(page.getByTestId("add-imported-set")).toBeDisabled();
      await expect(page.getByText("Questions (3)")).toBeVisible();

      // 3) Rearrange — move bank question to last; persist across reload
      const firstId = fixture.questionIds[0];
      await expect(page.getByTestId(`move-up-${firstId}`)).toBeDisabled({
        timeout: 15000,
      });
      await page.getByTestId(`move-down-${firstId}`).click();
      await page.getByTestId(`move-down-${firstId}`).click();
      await expect(page.getByTestId(`move-down-${firstId}`)).toBeDisabled({
        timeout: 15000,
      });
      await page.reload();
      await expect(page.getByTestId(`move-down-${firstId}`)).toBeDisabled({
        timeout: 15000,
      });

      // 4) Edit content via shared bank versioning (stem/options/key/explanation)
      await page.getByTestId(`edit-draft-question-${firstId}`).click();
      await page.waitForURL(new RegExp(`/admin/questions/${firstId}`));
      await expect(page.getByTestId("from-test-banner")).toBeVisible();
      await expect(page.getByTestId("back-to-draft-test")).toBeVisible();

      await page.getByPlaceholder("Which of the following…").fill(editedStem);
      await page.getByPlaceholder("Option B").fill("Edited option B");
      await page.locator("#correct-B").click();
      await page
        .getByPlaceholder("Why the correct answer is correct…")
        .fill(editedExplanation);
      await page.getByRole("button", { name: "Save as new version" }).click();
      await page.waitForURL(new RegExp(`/admin/tests/${draftId}`), {
        timeout: 20000,
      });
      await expect(page.getByText(editedStem)).toBeVisible({ timeout: 15000 });

      // 5) Leave and reopen — changes retained
      await page.goto("/admin/tests");
      if (await page.getByRole("heading", { name: "Select a class" }).isVisible()) {
        await page.getByRole("button", { name: /1st Year/i }).click();
      }
      await page.getByTestId(`edit-draft-test-${draftId}`).filter({ visible: true }).click();
      await page.waitForURL(new RegExp(`/admin/tests/${draftId}`));
      await expect(page.getByText(editedStem)).toBeVisible();
      await expect(page.getByText("Questions (3)")).toBeVisible();
      await expect(page.getByTestId(`move-down-${firstId}`)).toBeDisabled();

      // Published sibling: no draft Edit question / Remove
      await page.goto(`/admin/tests/${publishedId}`);
      await expect(page.getByText("published", { exact: true })).toBeVisible();
      await expect(page.getByTestId(`delete-draft-test-${publishedId}`)).toHaveCount(0);
      // No composition remove controls on published
      await expect(page.locator("[data-testid^=remove-draft-question-]")).toHaveCount(0);

      // 6) Remove one question from draft — bank row remains
      await page.goto(`/admin/tests/${draftId}`);
      removedQuestionId = fixture.questionIds[1];
      // May not be on test yet — add it if needed, else remove a CSV one by stem
      const removeBtn = page.getByTestId(`remove-draft-question-${firstId}`);
      await expect(removeBtn).toBeVisible();
      await removeBtn.click();
      await expect(page.getByText("Questions (2)")).toBeVisible({ timeout: 15000 });
      removedQuestionId = firstId;
      expect(await questionStillExists(firstId)).toBe(true);

      // Reopen final state — removed row is gone from composition (may still
      // appear in the bank pool below with the new version stem).
      await page.goto(`/admin/tests/${draftId}`);
      await expect(page.getByText("Questions (2)")).toBeVisible();
      await expect(
        page.getByTestId(`remove-draft-question-${firstId}`)
      ).toHaveCount(0);
      await expect(page.getByText(`${csvTag} stem one`)).toBeVisible();
      await expect(page.getByText(`${csvTag} stem two`)).toBeVisible();
    } finally {
      fs.unlinkSync(csvPath);
      await teardownQuestionPoolFixture(fixture, { testId: draftId });
      await deletePublishedTest(publishedId);
      if (removedQuestionId) {
        // Bank question must still exist after draft remove (not cleaned here —
        // fixture curriculum rows are left by design, same as other builder e2e).
        expect(await questionStillExists(removedQuestionId)).toBe(true);
      }
    }
  });
});
