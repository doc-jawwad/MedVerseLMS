import { test, expect, type Page } from "@playwright/test";
import {
  deleteStudent,
  provisionEnrolledStudent,
} from "./fixtures";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("Staging Admin/RBAC", () => {
  test("Main Admin can manage admins; students cannot open /admin", async ({
    page,
  }) => {
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "E2E_TARGET=staging required");

    const suffix = Math.random().toString(36).slice(2, 8);
    const email = `rbac-stg-${suffix}@test.invalid`;
    const password = `Rbac${suffix}Aa1!`;
    const student = await provisionEnrolledStudent();

    try {
      await login(page, e2e.adminEmail, e2e.adminPassword);
      await page.waitForURL(/\/(admin|dashboard)/, { timeout: 30000 });
      expect(page.url()).toContain("staging.medversepk.com");
      expect(page.url()).not.toContain("lms.medversepk.com");

      await page.goto("/admin/admins");
      await expect(page.getByRole("heading", { name: "Admins" })).toBeVisible({
        timeout: 20000,
      });
      await expect(
        page.getByText("Managing admins requires")
      ).toHaveCount(0);

      const createBox = page.locator("form").filter({
        has: page.getByRole("heading", { name: "Create a new admin account" }),
      });
      await createBox.getByLabel("Full name").fill(`RBAC Staging ${suffix}`);
      await createBox.getByLabel("Temporary password").fill(password);
      await createBox.getByLabel("Email").fill(email);
      await createBox.getByRole("button", { name: "Academic / MCQ" }).click();
      await createBox.getByRole("button", { name: "Create admin" }).click();
      await expect(page.getByText(email)).toBeVisible({ timeout: 30000 });

      const row = page.locator("tr", { hasText: email });
      await expect(row.getByText("edit_questions")).toBeVisible();

      await row.getByRole("button", { name: "Jobs" }).click();
      await page.getByRole("button", { name: "Operations" }).count();
      const jobsForm = page.locator("form").filter({
        has: page.getByRole("heading", { name: /Jobs for/ }),
      });
      // Switch to operations by checking view_students and unchecking edit_questions.
      const editBox = jobsForm
        .locator("label")
        .filter({ hasText: "Edit questions" })
        .getByRole("checkbox");
      const viewBox = jobsForm
        .locator("label")
        .filter({ hasText: "View students" })
        .getByRole("checkbox");
      if (await editBox.isChecked()) await editBox.click();
      if (!(await viewBox.isChecked())) await viewBox.click();
      await jobsForm.getByRole("button", { name: "Save jobs" }).click();
      await expect(row.getByText("view_students")).toBeVisible({
        timeout: 20000,
      });

      await row.getByRole("button", { name: "Disable" }).click();
      await expect(row.getByText("Suspended")).toBeVisible({ timeout: 20000 });
      await row.getByRole("button", { name: "Restore" }).click();
      await expect(row.getByText("Can use LMS")).toBeVisible({ timeout: 20000 });

      await row.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByText(email)).toHaveCount(0, { timeout: 20000 });

      const mainRow = page.locator("tr", { hasText: e2e.adminEmail });
      if ((await mainRow.count()) > 0) {
        const disable = mainRow.getByRole("button", { name: "Disable" });
        if (await disable.count()) {
          await expect(disable).toBeDisabled();
        }
        const remove = mainRow.getByRole("button", { name: "Remove" });
        if (await remove.count()) {
          await expect(remove).toBeDisabled();
        }
      }

      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/login/, { timeout: 15000 });

      await login(page, student.email, student.password);
      await page.waitForURL(/\/dashboard/, { timeout: 30000 });
      await page.goto("/admin/admins");
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
      expect(page.url().startsWith(`${STAGING_APP_ORIGIN}/dashboard`)).toBeTruthy();
    } finally {
      try {
        const usersRes = await fetch(
          `${e2e.authUrl.replace(/\/$/, "")}/auth/v1/admin/users?page=1&per_page=200`,
          {
            headers: {
              apikey: e2e.serviceRoleKey,
              Authorization: `Bearer ${e2e.serviceRoleKey}`,
            },
          }
        );
        const usersJson = (await usersRes.json()) as {
          users?: { id: string; email?: string }[];
        };
        const leftover = (usersJson.users ?? []).find((u) => u.email === email);
        if (leftover) await deleteStudent(leftover.id);
      } catch {
        /* cleanup best-effort */
      }
      await deleteStudent(student.studentId);
    }
  });
});
