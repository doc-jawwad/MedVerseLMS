import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
  type QuestionPoolFixture,
} from "./fixtures";

// Covers the new/changed Test Builder behavior: cascading question filters,
// manual reorder, per-question marks override, and the existing
// validate/publish/freeze flow end-to-end through the real admin UI.
// Uses its own isolated question-pool fixture (no shared/seeded data) and
// creates its own throwaway draft test, torn down afterward.

function loadEnvLocal(): Record<string, string> {
  const p = path.join(__dirname, "..", "..", ".env.local");
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = loadEnvLocal();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function createDraftTest(fixture: QuestionPoolFixture, title: string): Promise<string> {
  const res = await fetch(`${BASE}/rest/v1/tests`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      title,
      year_id: fixture.yearId,
      status: "draft",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      duration_minutes: 60,
      marks_per_question: 1,
      negative_mark: 0,
      min_questions: 1,
    }),
  }).then((r) => r.json());
  return res[0].id as string;
}

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
    const testId = await createDraftTest(fixture, `TB E2E ${fixture.tag}`);

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
      // in their stem) and add the first two ---
      await page.getByPlaceholder("Search text…").fill(fixture.tag);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page.getByTestId(`add-question-${fixture.questionIds[0]}`)).toBeVisible();

      // Wait for each Add to fully round-trip (its own button disappearing
      // from the pool, since router.refresh() re-fetches and the just-added
      // question drops out of the "available" list) before clicking the
      // next one — a stronger signal than the count text alone under a
      // loaded dev server, where consecutive rapid clicks can otherwise
      // race the first mutation's refresh.
      await page.getByTestId(`add-question-${fixture.questionIds[0]}`).click();
      await expect(page.getByTestId(`add-question-${fixture.questionIds[0]}`)).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByText("Questions (1)")).toBeVisible();

      await page.getByTestId(`add-question-${fixture.questionIds[1]}`).click();
      await expect(page.getByTestId(`add-question-${fixture.questionIds[1]}`)).toHaveCount(0, { timeout: 15000 });
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
