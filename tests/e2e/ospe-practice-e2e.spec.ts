/**
 * Staging OSPE Practice end-to-end: admin create → student reveal.
 * Disposable fixtures; asserts answer is absent before Reveal.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./fixtures";
import { loadE2EEnv } from "./load-e2e-env";

const fixtureImage = path.join(
  process.cwd(),
  "tests",
  "e2e",
  "fixtures",
  "ospe-station-qa.webp"
);

function tinyWebp(): Buffer {
  return Buffer.from(
    "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
    "base64"
  );
}

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30_000 });
}

test.describe("OSPE Practice staging E2E", () => {
  test.beforeAll(() => {
    fs.mkdirSync(path.dirname(fixtureImage), { recursive: true });
    if (!fs.existsSync(fixtureImage)) {
      fs.writeFileSync(fixtureImage, tinyWebp());
    }
  });

  test("admin publishes station; student reveals without preloaded answer", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const e2e = loadE2EEnv();
    test.skip(e2e.target !== "staging", "staging only");
    test.skip(
      !e2e.stagingStudentEmail || !e2e.stagingStudentPassword,
      "student creds required"
    );

    const tag = `QA OSPE ${Date.now()}`;

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin/ospe-stations");
    if (
      await page.getByRole("heading", { name: "Select a class" }).isVisible()
    ) {
      await page.getByRole("button", { name: /1st Year/i }).click();
      await page.waitForURL(/\/admin\/ospe-stations/);
    }

    await page.getByRole("link", { name: /Add station/i }).click();
    await page.waitForURL(/\/admin\/ospe-stations\/new/);

    await page.locator("#ospe-title").fill(tag);
    await page.locator("#ospe-answer").fill("QA reveal answer — axilla");

    // Radix Select for subject: open then choose first listed subject
    await page
      .locator("label")
      .filter({ hasText: /Block \/ subject/i })
      .locator("..")
      .getByRole("combobox")
      .click();
    await page.getByRole("option").first().click();

    await page.locator("#ospe-image").setInputFiles({
      name: "ospe-station-qa.webp",
      mimeType: "image/webp",
      buffer: fs.readFileSync(fixtureImage),
    });
    await page.getByRole("button", { name: /Create draft/i }).click();
    // Surface toast failures instead of only waiting on navigation.
    await Promise.race([
      page.waitForURL(/\/admin\/ospe-stations\/[0-9a-f-]+/, {
        timeout: 90_000,
      }),
      page
        .locator("[data-sonner-toast][data-type=error]")
        .first()
        .waitFor({ state: "visible", timeout: 90_000 })
        .then(async () => {
          const msg = await page
            .locator("[data-sonner-toast][data-type=error]")
            .first()
            .innerText();
          throw new Error(`createOspeStation failed: ${msg}`);
        }),
    ]);

    await page.getByRole("button", { name: /^Publish$/i }).click();
    await expect(page.getByRole("button", { name: /Unpublish/i })).toBeVisible({
      timeout: 20_000,
    });

    const stationId = page.url().split("/").pop()!;

    await context.clearCookies();
    await login(
      page,
      e2e.stagingStudentEmail!,
      e2e.stagingStudentPassword!
    );
    await page.goto("/practice/ospe");
    await expect(page.getByTestId("ospe-practice-session")).toBeVisible({
      timeout: 30_000,
    });

    const card = page.getByTestId("ospe-station-card");
    await expect(card).toBeVisible();

    const htmlBefore = await page.content();
    expect(htmlBefore.includes("QA reveal answer — axilla")).toBe(false);
    await expect(page.getByTestId("ospe-answer")).toHaveCount(0);

    for (let i = 0; i < 50; i++) {
      const title = await page.getByTestId("ospe-station-title").textContent();
      if (title?.includes(tag)) break;
      const next = page.getByRole("button", { name: /^Next$/i });
      if (!(await next.isEnabled())) break;
      await next.click();
      await page.waitForTimeout(150);
    }
    await expect(page.getByTestId("ospe-station-title")).toContainText(tag);

    const accessible = await card.getAttribute("data-accessible");
    if (accessible !== "1") {
      const imgRes = await page.request.get(`/api/ospe-stations/${stationId}`);
      expect(imgRes.status()).toBe(403);
      return;
    }

    await expect(page.getByTestId("ospe-station-image")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("ospe-reveal").click();
    await expect(page.getByTestId("ospe-answer")).toContainText(
      "QA reveal answer — axilla",
      { timeout: 15_000 }
    );

    const imgRes = await page.request.get(`/api/ospe-stations/${stationId}`);
    expect(imgRes.status()).toBe(200);
    const ct = imgRes.headers()["content-type"] || "";
    expect(ct.startsWith("image/")).toBe(true);
  });
});
