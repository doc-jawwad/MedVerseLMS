import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./fixtures";

async function adminLogin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/);
}

async function adminClassCookie(
  context: import("@playwright/test").BrowserContext
): Promise<string | undefined> {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name === "medverse_admin_year")?.value;
}

test.describe("Admin class source of truth", () => {
  test("Question Bank year chip keeps selector, URL, and cookie aligned", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await adminLogin(page);

    await page.goto("/admin/questions");
    // Class-first gate or already-selected class.
    if (await page.getByRole("heading", { name: "Select a class" }).isVisible()) {
      await page.getByRole("button", { name: /1st Year/i }).click();
      await page.waitForURL(/\/admin\/questions/);
    } else {
      // Force 1st Year via the layout selector.
      await page.getByTestId("admin-class-selector").click();
      await page.getByRole("option", { name: /1st Year/i }).click();
      await page.waitForURL(/year=/);
    }

    await expect(page.getByTestId("admin-class-selector")).toContainText(/1st Year/i);

    const y1Cookie = await adminClassCookie(context);
    expect(y1Cookie).toBeTruthy();

    await page.getByTestId("admin-year-chip-3").click();
    await expect(page.getByTestId("admin-class-selector")).toContainText(
      /3rd Year/i
    );
    await expect
      .poll(async () => adminClassCookie(context), { timeout: 15_000 })
      .not.toBe(y1Cookie);

    const y3Cookie = await adminClassCookie(context);
    expect(y3Cookie).toBeTruthy();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("year"), {
        timeout: 15_000,
      })
      .toBe(y3Cookie);

    await expect(page.getByTestId("admin-year-chip-3")).toHaveClass(
      /bg-primary/
    );
  });

  test("Create Test defaults Year to the selected admin class", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await adminLogin(page);

    await page.goto("/admin/tests/new");
    if (await page.getByRole("heading", { name: "Select a class" }).isVisible()) {
      await page.getByRole("button", { name: /3rd Year/i }).click();
      await page.waitForURL(/\/admin\/tests\/new/);
    } else {
      await page.getByTestId("admin-class-selector").click();
      await page.getByRole("option", { name: /3rd Year/i }).click();
      await page.waitForURL(/year=/);
      await page.goto("/admin/tests/new");
    }

    await expect(page.getByTestId("admin-class-selector")).toContainText(
      /3rd Year/i
    );
    await expect(page.getByTestId("test-year-locked")).toHaveText(/Year 3/);
  });
});
