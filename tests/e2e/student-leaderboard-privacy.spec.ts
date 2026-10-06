import { test, expect, type Page } from "@playwright/test";
import {
  closeTestNow,
  provisionExamFixture,
  teardownExamFixture,
} from "./fixtures";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
}

async function sitAndSubmit(page: Page, testId: string) {
  await page.goto(`/tests/${testId}/attempt`);
  await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 15000 });
  await page.getByTestId("option-A").click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByText("Submit the exam?")).toBeVisible();
  await page.getByRole("button", { name: "Submit now" }).click();
  await page.waitForURL(/\/result/, { timeout: 15000 });
}

function assertBoardHidesAdminFields(board: ReturnType<Page["locator"]>, email: string) {
  return Promise.all([
    expect(board.getByText(email)).toHaveCount(0),
    expect(board.getByText("LMS access")).toHaveCount(0),
    expect(board.getByText("Can use LMS")).toHaveCount(0),
    expect(board.getByText("Current class")).toHaveCount(0),
  ]);
}

test.describe("Student leaderboard privacy", () => {
  test("unauthenticated dashboard and result stay behind login", async ({
    page,
  }) => {
    const dash = await page.goto("/dashboard");
    expect(dash?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);

    const result = await page.goto(
      "/tests/00000000-0000-0000-0000-000000000001/result"
    );
    expect(result?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });

  test("result and last-test boards show name/score and hide admin fields", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 1 });
    try {
      await login(page, fixture.email, fixture.password);
      await sitAndSubmit(page, fixture.testId);

      await expect(page.getByText("Leaderboard")).toBeVisible();
      await expect(page.getByText("# YOU")).toBeVisible();
      await expect(page.getByText(/1\/1/)).toBeVisible();
      await expect(page.getByText(fixture.email)).toHaveCount(0);
      await expect(page.getByText("LMS access")).toHaveCount(0);
      await expect(page.getByText("Can use LMS")).toHaveCount(0);
      await expect(page.getByText("Current class")).toHaveCount(0);

      await closeTestNow(fixture.testId);
      await page.goto("/dashboard");
      const board = page.getByRole("main").getByTestId("leaderboard-board");
      await expect(board).toBeVisible({ timeout: 20000 });
      await expect(board.getByText("Last test leaderboard")).toBeVisible();
      const rankedRow = board.getByTestId("leaderboard-row");
      if ((await rankedRow.count()) > 0) {
        await expect(rankedRow.first().getByText("E2E Student")).toBeVisible();
        await expect(board.getByText("College not set")).toBeVisible();
      } else {
        await expect(
          board.getByText(/No ranking yet|No completed test|Leaderboard unavailable/)
        ).toBeVisible();
      }
      await assertBoardHidesAdminFields(board, fixture.email);
      await expect(page.getByTestId("dashboard-historical")).toBeVisible();
      await expect(page.getByTestId("dashboard-historical").getByText(fixture.email)).toHaveCount(0);
    } finally {
      await teardownExamFixture(fixture);
    }
  });
});
