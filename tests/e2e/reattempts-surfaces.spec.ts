import { test, expect, type Page } from "@playwright/test";
import {
  createDraftProfSessionDay,
  linkTestToProfSessionDay,
  markTestPaidWithLiveSubscription,
  profSessionProductKey,
  publishProfSessionDayForE2e,
  provisionExamFixture,
  softDeleteProfSessionDayForE2e,
  teardownExamFixture,
} from "./fixtures";
import { loadE2EEnv } from "./load-e2e-env";

// Retake surfaces beyond the Tests page: dashboard incoming list and the
// Prof. Session day "Test MCQs" slot. Attempt limits / paid-test behaviour are
// covered by pgTAP, not here. Staging only.

const env = loadE2EEnv();
test.skip(
  env.target !== "staging" || !env.stagingSsh,
  "reattempt surface E2E runs against staging only (needs E2E_STAGING_SSH)"
);

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

async function submitFirstAttempt(page: Page, testId: string) {
  await page.goto(`/tests/${testId}/attempt`);
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 20000 });
  await page.getByTestId("option-B").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10000 });
  await page.getByRole("button", { name: "Submit exam" }).click();
  await page.getByRole("button", { name: "Submit now" }).click();
  await page.waitForURL(/\/result/, { timeout: 20000 });
}

test.describe("Retake surfaces (staging)", () => {
  test.setTimeout(240_000);

  test("dashboard incoming card offers Retake test with ?attempt=2", async ({ page }) => {
    const f = await provisionExamFixture({ questionCount: 2, maxAttempts: 2 });
    try {
      await login(page, f.email, f.password);
      await submitFirstAttempt(page, f.testId);

      await page.goto("/dashboard");
      const card = page
        .locator("div.grid.gap-2")
        .filter({ hasText: f.title })
        .filter({ has: page.getByRole("link", { name: "Retake test" }) });
      await expect(card).toHaveCount(1, { timeout: 20000 });
      await expect(card.getByRole("link", { name: "Retake test" })).toHaveAttribute(
        "href",
        new RegExp(`/tests/${f.testId}/attempt[?]attempt=2$`)
      );
      await expect(card.getByRole("link", { name: "Start test" })).toHaveCount(0);
    } finally {
      await teardownExamFixture(f);
    }
  });

  test("Prof. Session slot page shows retake state and usage", async ({ page }) => {
    const f = await provisionExamFixture({ questionCount: 2, maxAttempts: 2 });
    const { dayId, subjectId } = await createDraftProfSessionDay(
      `Day Retake ${f.title}`
    );
    const sub = await markTestPaidWithLiveSubscription(f.testId, f.studentId);
    try {
      await publishProfSessionDayForE2e(dayId);
      await linkTestToProfSessionDay(f.testId, dayId);
      const productKey = await profSessionProductKey(subjectId);
      await login(page, f.email, f.password);
      await submitFirstAttempt(page, f.testId);

      await page.goto(
        `/academic/prof-session/${productKey}/mcq-bank/${dayId}/test-mcq`
      );
      const card = page.locator('[data-slot="card"]').filter({ hasText: f.title });
      await expect(card).toHaveCount(1, { timeout: 20000 });
      await expect(card.getByText("Retake available")).toBeVisible();
      await expect(card.getByTestId("slot-attempt-count")).toHaveText(
        "Attempts used: 1 of 2"
      );
      await expect(card.getByRole("link", { name: "Retake test" })).toHaveAttribute(
        "href",
        new RegExp(`/tests/${f.testId}/attempt[?]attempt=2$`)
      );
      await expect(card.getByRole("link", { name: "View result" })).toBeVisible();
    } finally {
      // Independent steps: one failing (e.g. staging SSH) must not skip the rest.
      const steps: [string, () => Promise<unknown>][] = [
        ["subscription", () => sub.cleanup()],
        ["day", () => softDeleteProfSessionDayForE2e(dayId)],
        ["student+test", () => teardownExamFixture(f)],
      ];
      for (const [name, run] of steps) {
        await run().catch((e) =>
          console.warn(`[cleanup] ${name} left behind (${f.email}, test ${f.testId}, day ${dayId}): ${e}`)
        );
      }
    }
  });
});
