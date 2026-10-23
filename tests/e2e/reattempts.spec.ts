import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  changeStudentYear,
  closeTestNow,
  invalidateAttemptAsAdmin,
  listAttemptsForE2e,
  provisionExamFixture,
  rankDirtyNow,
  teardownExamFixture,
  type ExamFixture,
} from "./fixtures";
import { loadE2EEnv } from "./load-e2e-env";

// Test reattempts (tests.max_attempts) against the real staging app + database.
// docs/test-rules.md "Attempt limit and reattempts"; docs/exam-state-machine.md.
// Each test provisions its own student + published test and tears them down.
// Staging only: ranking/DB assertions use the guarded SSH bridge.

const env = loadE2EEnv();
test.skip(
  env.target !== "staging" || !env.stagingSsh,
  "reattempt E2E runs against staging only (needs E2E_STAGING_SSH)"
);

const EXPLANATION = "A is correct by fixture design.";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** Open the attempt page (optionally as a retake) and wait for the exam. */
async function openExam(page: Page, testId: string, attemptNo?: number) {
  await page.goto(
    `/tests/${testId}/attempt${attemptNo ? `?attempt=${attemptNo}` : ""}`
  );
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 20000 });
}

/** Answer question 1 (A = correct, B = wrong), save, submit, land on the result. */
async function answerAndSubmit(page: Page, key: "A" | "B") {
  await page.getByTestId(`option-${key}`).click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10000 });
  await page.getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByText("Submit the exam?")).toBeVisible();
  await page.getByRole("button", { name: "Submit now" }).click();
  await page.waitForURL(/\/result/, { timeout: 20000 });
  await expect(page.getByTestId("result-summary").first()).toBeVisible();
}

async function sit(page: Page, f: ExamFixture, key: "A" | "B", attemptNo?: number) {
  await openExam(page, f.testId, attemptNo);
  await answerAndSubmit(page, key);
}

async function testsCard(page: Page, f: ExamFixture): Promise<Locator> {
  await page.goto("/tests");
  const card = page
    .locator('[data-testid^="tests-card-"]')
    .filter({ hasText: f.title });
  await expect(card).toHaveCount(1, { timeout: 20000 });
  return card;
}

const cardState = async (card: Locator) =>
  (await card.getAttribute("data-testid"))?.replace("tests-card-", "");

test.describe("Test reattempts (staging)", () => {
  test.setTimeout(360_000);

  test("full reattempt lifecycle: labels, resume, limit, review hold, ranking, invalidation", async ({
    page,
  }) => {
    const f = await provisionExamFixture({
      questionCount: 2,
      maxAttempts: 3,
      showReview: "after_submit",
    });
    try {
      await login(page, f.email, f.password);

      await test.step("first attempt: Available, no retake yet", async () => {
        const card = await testsCard(page, f);
        expect(await cardState(card)).toBe("available");
        await expect(card.getByText("Available", { exact: true })).toBeVisible();
        await expect(card.getByRole("link", { name: "Retake test" })).toHaveCount(0);
        // multi-attempt tests show usage even before the first sit
        await expect(card.getByTestId("tests-attempt-count")).toHaveText(
          "Attempts used: 0 of 3"
        );
      });

      await test.step("attempt 1 (wrong) -> review is HELD, no answer keys", async () => {
        await sit(page, f, "B");
        await expect(page.getByTestId("result-attempts")).toContainText("1 of 3 used");
        await expect(page.getByTestId("result-review-held")).toBeVisible();
        await expect(page.getByText(EXPLANATION)).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Question review" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Retake test" })).toBeVisible();
      });

      await test.step("Tests page: Retake available with usage and ?attempt=2 link", async () => {
        const card = await testsCard(page, f);
        expect(await cardState(card)).toBe("retake_available");
        await expect(card.getByText("Retake available")).toBeVisible();
        await expect(card.getByTestId("tests-attempt-count")).toHaveText(
          "Attempts used: 1 of 3"
        );
        await expect(card.getByRole("link", { name: "Retake test" })).toHaveAttribute(
          "href",
          new RegExp(`/tests/${f.testId}/attempt\\?attempt=2$`)
        );
      });

      await test.step("retake starts attempt 2; reload resumes the same attempt", async () => {
        await openExam(page, f.testId, 2);
        await page.getByTestId("option-A").click();
        await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10000 });
        await page.reload();
        await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 20000 });
        await expect(page.getByTestId("option-A")).toHaveAttribute("aria-pressed", "true");

        const rows = await listAttemptsForE2e(f.testId, f.studentId);
        expect(rows.map((r) => r.state)).toEqual(["submitted", "in_progress"]);

        const card = await testsCard(page, f);
        expect(await cardState(card)).toBe("in_progress");
        await expect(card.getByTestId("tests-attempt-count")).toHaveText("Attempt 2 of 3");
        await expect(card.getByRole("link", { name: "Resume test" })).toBeVisible();
        await expect(card.getByRole("link", { name: "Retake test" })).toHaveCount(0);
      });

      await test.step("submit attempt 2 (correct): history kept, best attempt ranked", async () => {
        await openExam(page, f.testId); // plain resume of the live attempt
        await expect(page.getByTestId("option-A")).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "Submit exam" }).click();
        await page.getByRole("button", { name: "Submit now" }).click();
        await page.waitForURL(/\/result/, { timeout: 20000 });

        await rankDirtyNow();
        const rows = await listAttemptsForE2e(f.testId, f.studentId);
        expect(rows.map((r) => r.state)).toEqual(["submitted", "submitted"]);
        expect(rows.map((r) => r.score)).toEqual([0, 1]); // attempt 1 preserved
        expect(rows.map((r) => r.rank)).toEqual([null, 1]); // only the best is ranked

        await page.reload();
        const items = page.getByTestId("result-attempt-row");
        await expect(items).toHaveCount(2);
        await expect(items.nth(1)).toContainText("counts for your rank");
        await expect(items.nth(0)).not.toContainText("counts for your rank");
        await expect(page.getByTestId("result-summary").first()).toContainText("1 / 2");
      });

      await test.step("attempt 3 exhausts the limit: Result, no retake, review opens", async () => {
        await sit(page, f, "B", 3);
        const card = await testsCard(page, f);
        expect(await cardState(card)).toBe("result");
        await expect(card.getByTestId("tests-attempt-count")).toHaveText(
          "Attempts used: 3 of 3"
        );
        await expect(card.getByRole("link", { name: "Retake test" })).toHaveCount(0);

        await page.goto(`/tests/${f.testId}/result`);
        await expect(page.getByTestId("result-review-held")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Question review" })).toBeVisible();
        await expect(page.getByText(EXPLANATION).first()).toBeVisible();
        await expect(page.getByRole("link", { name: "Retake test" })).toHaveCount(0);

        // a 4th attempt is refused by the server, not just hidden in the UI
        await page.goto(`/tests/${f.testId}/attempt?attempt=4`);
        await expect(page.getByText("No attempts left")).toBeVisible({ timeout: 20000 });
        const rows = await listAttemptsForE2e(f.testId, f.studentId);
        expect(rows).toHaveLength(3);
      });

      await test.step("admin invalidation: history kept, rank recomputed, retake freed", async () => {
        const before = await listAttemptsForE2e(f.testId, f.studentId);
        await invalidateAttemptAsAdmin(before[1].id, "e2e invalidation");
        await rankDirtyNow();

        const rows = await listAttemptsForE2e(f.testId, f.studentId);
        expect(rows.map((r) => r.state)).toEqual(["submitted", "invalidated", "submitted"]);
        expect(rows[1].score).toBe(1); // invalidated attempt and its score preserved
        // best remaining = 0, tie -> earliest submit; exactly one submitted row ranked
        expect(rows.filter((r) => r.state === "submitted" && r.rank !== null)).toHaveLength(1);
        expect(rows[0].rank).toBe(1);

        await page.goto(`/tests/${f.testId}/result`);
        await expect(page.getByText(/previous attempt was invalidated/i)).toBeVisible();
        await expect(page.getByTestId("result-attempt-row").nth(0)).toContainText(
          "counts for your rank"
        );
        await expect(page.getByTestId("result-summary").first()).toContainText("0 / 2");

        const card = await testsCard(page, f);
        expect(await cardState(card)).toBe("retake_available");
        await expect(card.getByTestId("tests-attempt-count")).toHaveText(
          "Attempts used: 2 of 3"
        );
      });
    } finally {
      await teardownExamFixture(f);
    }
  });

  test("closed test: retake is refused and not offered", async ({ page }) => {
    const f = await provisionExamFixture({ questionCount: 2, maxAttempts: 2 });
    try {
      await login(page, f.email, f.password);
      await sit(page, f, "B");
      await closeTestNow(f.testId);

      const card = await testsCard(page, f);
      expect(await cardState(card)).toBe("result");
      await expect(card.getByRole("link", { name: "Retake test" })).toHaveCount(0);

      await page.goto(`/tests/${f.testId}/result`);
      await expect(page.getByRole("link", { name: "Retake test" })).toHaveCount(0);

      await page.goto(`/tests/${f.testId}/attempt?attempt=2`);
      await expect(page.getByText("Test not open")).toBeVisible({ timeout: 20000 });
      expect(await listAttemptsForE2e(f.testId, f.studentId)).toHaveLength(1);
    } finally {
      await teardownExamFixture(f);
    }
  });

  test("single-attempt flow is unchanged (max_attempts = 1)", async ({ page }) => {
    const f = await provisionExamFixture({ questionCount: 2, showReview: "after_submit" });
    try {
      await login(page, f.email, f.password);
      await sit(page, f, "A");

      // review opens immediately (no hold on single-attempt tests)
      await expect(page.getByTestId("result-review-held")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Question review" })).toBeVisible();
      await expect(page.getByText(EXPLANATION).first()).toBeVisible();
      await expect(page.getByTestId("result-attempts")).toHaveCount(0);

      const card = await testsCard(page, f);
      expect(await cardState(card)).toBe("result");
      await expect(card.getByTestId("tests-attempt-count")).toHaveCount(0);
      await expect(card.getByRole("link", { name: "Retake test" })).toHaveCount(0);

      // revisiting the attempt URL, with or without an attempt number, goes to the result
      await page.goto(`/tests/${f.testId}/attempt`);
      await page.waitForURL(/\/result/, { timeout: 20000 });
      await page.goto(`/tests/${f.testId}/attempt?attempt=2`);
      await page.waitForURL(/\/result/, { timeout: 20000 });
      expect(await listAttemptsForE2e(f.testId, f.studentId)).toHaveLength(1);
    } finally {
      await teardownExamFixture(f);
    }
  });

  test("double retake (two tabs at once) creates exactly one new attempt", async ({
    context,
    page,
  }) => {
    const f = await provisionExamFixture({ questionCount: 2, maxAttempts: 2 });
    try {
      await login(page, f.email, f.password);
      await sit(page, f, "B");

      const second = await context.newPage();
      await Promise.all([
        page.goto(`/tests/${f.testId}/attempt?attempt=2`),
        second.goto(`/tests/${f.testId}/attempt?attempt=2`),
      ]);
      await expect(
        page.getByText(/Question 1 of/).or(page.getByText(/already open in another tab/i))
      ).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(3000);

      const rows = await listAttemptsForE2e(f.testId, f.studentId);
      expect(rows.map((r) => r.state)).toEqual(["submitted", "in_progress"]);
      await second.close();
    } finally {
      await teardownExamFixture(f);
    }
  });

  test("access checks still apply to retakes (class change blocks the retake)", async ({
    page,
  }) => {
    const f = await provisionExamFixture({ questionCount: 2, maxAttempts: 2 });
    try {
      await login(page, f.email, f.password);
      await sit(page, f, "B");
      await changeStudentYear(f.studentId, 3);

      await page.goto(`/tests/${f.testId}/attempt?attempt=2`);
      await expect(
        page.getByText(/No access|requires a live subscription|Test not open/).first()
      ).toBeVisible({ timeout: 20000 });
      // the server refused: no second attempt row exists
      expect(await listAttemptsForE2e(f.testId, f.studentId)).toHaveLength(1);
    } finally {
      await teardownExamFixture(f);
    }
  });
});
