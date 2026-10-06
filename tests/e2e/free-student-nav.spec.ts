import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Free-student shell policy — unified Academic tree + locked Prof. Session.
 * Performance is merged into Dashboard; /performance redirects to /dashboard.
 * Staging credentials must be a free (non–live-subscription) student.
 * Before login, expire any accidental live subscription on "Staging Student"
 * so approve-application walkthroughs cannot poison this suite.
 */
function ensureStagingStudentFixtureIsFree() {
  const ssh = process.env.E2E_STAGING_SSH || "medverse-vps";
  const sql =
    "update public.subscriptions set status='expired', ends_at=now() " +
    "where status='active' and student_id=(" +
    "select id from public.profiles where full_name='Staging Student' limit 1" +
    ") and current_database()='medverse_staging';";
  try {
    execFileSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        ssh,
        `sudo -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
      ],
      { stdio: "pipe" }
    );
  } catch (err) {
    throw new Error(
      `free-student-nav: could not reset Staging Student to free via ${ssh}: ${err}`
    );
  }
}

test.describe("Free student navigation", () => {
  test("enrolled-class Blocks only; Prof. Session locked; /performance redirects to /dashboard", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(
      e2e.target !== "staging",
      "Set E2E_TARGET=staging (deployed build with Academic IA)"
    );
    test.skip(
      !e2e.stagingStudentEmail || !e2e.stagingStudentPassword,
      "E2E_STAGING_STUDENT_EMAIL/PASSWORD required"
    );

    ensureStagingStudentFixtureIsFree();

    await page.goto("/login");
    expect(page.url().startsWith(STAGING_APP_ORIGIN)).toBeTruthy();

    await page.getByLabel("Email").fill(e2e.stagingStudentEmail!);
    await page.getByLabel("Password").fill(e2e.stagingStudentPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });

    // Exactly one class year in shell — not all five.
    const yearLinks = page.getByRole("link", { name: /Year MBBS|Final Year MBBS/ });
    await expect(yearLinks.first()).toBeVisible();
    expect(await yearLinks.count()).toBe(1);
    await expect(page.getByRole("link", { name: "OSPE Practice" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Tests" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact Us" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Prof. Session" })).toBeVisible();
    await expect(page.getByRole("link", { name: "MCQ Bank" })).toHaveCount(0);

    await page.goto("/academic");
    await expect(page.getByRole("heading", { name: "Academic" })).toBeVisible({
      timeout: 15000,
    });
    // Main lists Blocks for enrolled class — not a grid of all five year cards.
    // Sidebar may still show the enrolled year name as a nav link.
    const main = page.locator("main");
    await expect(main.getByRole("link", { name: /Year MBBS|Final Year MBBS/ })).toHaveCount(0);
    await expect(
      main.getByRole("link", { name: /^(Block \d+|Medicine|Surgery|Gynecology|Pediatrics)$/ }).first()
    ).toBeVisible();

    await page.goto("/academic/year/5");
    await page.waitForURL(/\/academic\/?$/, { timeout: 15000 });
    expect(page.url()).toMatch(/\/academic\/?$/);

    await page.goto("/academic/block-12");
    await page.waitForURL(/\/academic\/?$/, { timeout: 15000 });
    // Cross-year block deep links redirect to Academic home when enrolled elsewhere.
    // (block-12 is Year 4 — Staging Student is typically Year 1 or 2)

    // SectionLock badge text also matches its wrapper; scope to main + exact.
    const subscriptionRequiredBadge = page
      .locator("main")
      .getByText("subscription required", { exact: true });

    await page.goto("/academic/prof-session");
    await expect(subscriptionRequiredBadge.first()).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: "Get Subscription" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse Academic" })
    ).toBeVisible();

    await page.goto("/mock-test");
    await expect(subscriptionRequiredBadge.first()).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: "Get Subscription" })
    ).toBeVisible();

    await page.goto("/mcq-bank");
    await expect(subscriptionRequiredBadge.first()).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: "Contact Us" })).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/tests");
    await expect(page.getByRole("heading", { name: "Tests" })).toBeVisible({
      timeout: 15000,
    });
    await expect(subscriptionRequiredBadge).toHaveCount(0);

    // /performance merged into Dashboard — must redirect, not show a lock page
    await page.goto("/performance");
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible({
      timeout: 15000,
    });

    // Performance nav item must not appear in the sidebar
    await expect(page.getByRole("link", { name: "Performance" })).toHaveCount(0);
  });
});
