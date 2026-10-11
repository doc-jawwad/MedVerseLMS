import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  closeTestNow,
  provisionExamFixture,
  teardownExamFixture,
} from "./fixtures";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

/**
 * Focused Batch B staging validation (return-to-draft, reuse, syllabus).
 * Staging-only. Does not mutate production.
 */

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Admins land on /admin; students on /dashboard.
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30000 });
}

function stagingSql(sql: string): string {
  const ssh = process.env.E2E_STAGING_SSH || loadE2EEnv().stagingSsh || "medverse-vps";
  return execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      ssh,
      `sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -Atqc ${JSON.stringify(sql)}`,
    ],
    { encoding: "utf8" }
  ).trim();
}

/** Fixture-only: bypass protect_published_test while shaping published rows. */
function stagingSqlBypassTriggers(sql: string): void {
  const ssh = process.env.E2E_STAGING_SSH || loadE2EEnv().stagingSsh || "medverse-vps";
  const script = `SET session_replication_role = replica; ${sql}; SET session_replication_role = DEFAULT;`;
  execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      ssh,
      `sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(script)}`,
    ],
    { encoding: "utf8" }
  );
}

test.describe("Batch B staging", () => {
  test.beforeAll(() => {
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "E2E_TARGET=staging required");
    expect(e2e.baseURL.startsWith(STAGING_APP_ORIGIN)).toBeTruthy();
  });

  test("staging DB head and lifecycle RPCs exist", async () => {
    const head = stagingSql(
      "select version from supabase_migrations.schema_migrations order by version desc limit 1"
    );
    expect(head).toBe("20261011120000");

    const release = stagingSql(
      "select pg_read_file('/opt/medverse-staging/current/RELEASE_COMMIT', 0, 64)"
    );
    expect(release.length).toBeGreaterThan(10);

    const funcs = stagingSql(
      "select string_agg(proname, ',' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('return_to_draft_test','reuse_test_as_draft')"
    );
    expect(funcs).toContain("return_to_draft_test");
    expect(funcs).toContain("reuse_test_as_draft");

    const syllabusCol = stagingSql(
      "select count(*)::text from information_schema.columns where table_schema='public' and table_name='tests' and column_name='syllabus'"
    );
    expect(syllabusCol).toBe("1");
  });

  test("B1 return to draft for unopened published test", async ({ page }) => {
    const fixture = await provisionExamFixture({ questionCount: 1 });
    try {
      // Move window to future so return-to-draft is eligible (fixture setup).
      stagingSqlBypassTriggers(
        `update public.tests set opens_at = now() + interval '2 hours', closes_at = now() + interval '5 hours', syllabus = 'Batch B syllabus E2E' where id = '${fixture.testId}'`
      );

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(`/admin/tests/${fixture.testId}`);
      const returnBtn = page.getByTestId("return-to-draft-button").first();
      await expect(returnBtn).toBeVisible({ timeout: 15000 });
      await returnBtn.click();
      await page.getByTestId("return-to-draft-confirm").last().click();
      await expect(page.getByText("draft", { exact: true }).first()).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId("test-syllabus").first()).toHaveValue(
        /Batch B syllabus E2E/
      );
      await expect(page.getByTestId("publish-test-button").first()).toBeVisible();
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("B2 reuse closed test as new draft; source preserved", async ({
    page,
  }) => {
    const fixture = await provisionExamFixture({ questionCount: 1 });
    try {
      stagingSqlBypassTriggers(
        `update public.tests set syllabus = 'Reuse syllabus body' where id = '${fixture.testId}'`
      );
      await closeTestNow(fixture.testId);

      const sourceBefore = stagingSql(
        `select title || '|' || status || '|' || coalesce(syllabus,'') from public.tests where id = '${fixture.testId}'`
      );

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(`/admin/tests/${fixture.testId}`);
      const reuseBtn = page.getByTestId("reuse-as-draft-button").first();
      await expect(reuseBtn).toBeVisible({ timeout: 15000 });
      await reuseBtn.click();
      await page.getByTestId("reuse-as-draft-confirm").last().click();
      await page.waitForURL(
        (url) =>
          /\/admin\/tests\/[0-9a-f-]{36}/i.test(url.pathname) &&
          !url.pathname.includes(fixture.testId),
        { timeout: 20000 }
      );
      const newUrl = page.url();
      expect(newUrl).not.toContain(fixture.testId);
      await expect(page.getByTestId("test-syllabus")).toHaveValue(
        /Reuse syllabus body/
      );

      const sourceAfter = stagingSql(
        `select title || '|' || status || '|' || coalesce(syllabus,'') from public.tests where id = '${fixture.testId}'`
      );
      expect(sourceAfter).toBe(sourceBefore);

      const newId = newUrl.split("/admin/tests/")[1]?.split(/[?#]/)[0];
      if (newId) {
        stagingSql(`delete from public.tests where id = '${newId}'`);
      }
    } finally {
      await teardownExamFixture(fixture);
    }
  });

  test("B3 student sees plain-text syllabus before start", async ({ page }) => {
    const fixture = await provisionExamFixture({ questionCount: 1 });
    try {
      stagingSqlBypassTriggers(
        `update public.tests set opens_at = now() + interval '1 hour', closes_at = now() + interval '4 hours', syllabus = 'Student-visible syllabus line' where id = '${fixture.testId}'`
      );

      await login(page, fixture.email, fixture.password);
      await page.goto("/tests");
      await expect(page.getByTestId("test-syllabus-panel")).toContainText(
        "Student-visible syllabus line",
        { timeout: 20000 }
      );
    } finally {
      await teardownExamFixture(fixture);
    }
  });
});
