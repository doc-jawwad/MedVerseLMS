import { test, expect, type Page } from "@playwright/test";
import {
  markTestPaidWithLiveSubscription,
  provisionExamFixture,
  seedSubmittedInWindowFillersForDashboardCap,
  teardownDashboardCapFillers,
  teardownExamFixture,
  yearIdForTestE2e,
} from "./fixtures";
import { loadE2EEnv } from "./load-e2e-env";
import { DASHBOARD_UPCOMING_LIMIT } from "../../src/lib/dashboard/derive-upcoming-from-catalog";

/**
 * Issue #4 — paid dashboard hid open tests when ≥20 finished-but-still-in-window
 * tests consumed the upcoming cap before the incoming-state filter.
 * Staging only (needs E2E_STAGING_SSH for filler attempt inserts).
 */

const env = loadE2EEnv();
test.skip(
  env.target !== "staging" || !env.stagingSsh,
  "dashboard incoming-cap E2E runs against staging only (needs E2E_STAGING_SSH)"
);

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe("Dashboard incoming cap (Issue #4, staging)", () => {
  test.setTimeout(240_000);

  test("open paid test stays visible when 20 submitted in-window fillers would fill the old cap", async ({
    page,
  }) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const tag = `E2E_CAP_${suffix}`;
    // Open fixture opens ~now-60s; fillers open earlier so the old limit-20
    // slice would exclude this test before the incoming-state filter.
    const open = await provisionExamFixture({ questionCount: 1 });
    const yearId = await yearIdForTestE2e(open.testId);
    const paid = await markTestPaidWithLiveSubscription(
      open.testId,
      open.studentId
    );
    // Last filler opens at base+(19)min; keep that before open's ~now-1min.
    const fillersBase = Date.now() - (DASHBOARD_UPCOMING_LIMIT + 10) * 60_000;
    let fillerIds: string[] = [];
    try {
      fillerIds = await seedSubmittedInWindowFillersForDashboardCap({
        studentId: open.studentId,
        yearId,
        count: DASHBOARD_UPCOMING_LIMIT,
        opensAtBaseMs: fillersBase,
        tag,
      });

      await login(page, open.email, open.password);
      await page.goto("/dashboard");
      await expect(page.getByText("Incoming tests", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const card = page
        .locator("div.grid.gap-2")
        .filter({ hasText: open.title })
        .filter({ has: page.getByRole("link", { name: "Start test" }) });
      await expect(card).toHaveCount(1, { timeout: 20_000 });
      await expect(page.getByText(`${tag}_filler_0`)).toHaveCount(0);
    } finally {
      await paid.cleanup().catch((e) =>
        console.warn(`[cleanup] subscription: ${e}`)
      );
      await teardownDashboardCapFillers(fillerIds).catch((e) =>
        console.warn(`[cleanup] fillers: ${e}`)
      );
      await teardownExamFixture(open).catch((e) =>
        console.warn(`[cleanup] open fixture: ${e}`)
      );
    }
  });
});
