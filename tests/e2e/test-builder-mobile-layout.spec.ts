import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createDraftTestForBuilder,
  provisionQuestionPoolFixture,
  teardownQuestionPoolFixture,
} from "./fixtures";

async function pageOverflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
  );
}

/** True if any rendered descendant extends past the viewport right edge. */
async function hasClippedDescendants(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > vw + 1) {
        const tid = el.getAttribute("data-testid");
        offenders.push(
          tid
            ? `[data-testid=${tid}] right=${Math.round(r.right)}`
            : `${el.tagName.toLowerCase()}.${String(el.className)
                .split(/\s+/)
                .slice(0, 2)
                .join(".")} right=${Math.round(r.right)}`
        );
      }
    }
    return offenders.slice(0, 12);
  });
}

async function expectUsableInViewport(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const ok = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    return r.width > 0 && r.left >= -1 && r.right <= vw + 1;
  });
  expect(ok, `${label} clipped`).toBe(true);
}

/**
 * Focused mobile layout check for Test Creation / Test Builder.
 * Does not cover CSV import logic, random selection logic, or publish.
 */
test.describe("Test Builder mobile layout", () => {
  test("mobile viewport: no page overflow; CSV/filters/random/pool usable", async ({
    page,
  }) => {
    test.setTimeout(75_000);
    const fixture = await provisionQuestionPoolFixture({ questionCount: 2 });
    const testId = await createDraftTestForBuilder(
      fixture,
      `TB MOB ${fixture.tag}`
    );

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(`/admin/tests/${testId}`);
      await expect(page.getByText(`TB MOB ${fixture.tag}`)).toBeVisible();

      const csvRoot = page.getByTestId("test-builder-csv-import");
      await expect(csvRoot).toBeVisible();
      await expectUsableInViewport(
        page.getByTestId("test-builder-csv-choose"),
        "csv choose"
      );
      await expectUsableInViewport(
        page.getByTestId("add-random-from-filter"),
        "random add"
      );
      await expectUsableInViewport(
        page.locator('form select[name="subject"]'),
        "subject filter"
      );
      await expectUsableInViewport(
        page.getByPlaceholder("Search text…"),
        "search"
      );
      await expect(
        page.getByTestId(`tick-question-${fixture.questionIds[0]}`)
      ).toBeVisible({ timeout: 15_000 });
      await expectUsableInViewport(
        page.getByTestId(`tick-question-${fixture.questionIds[0]}`),
        "pool tick"
      );

      expect(await pageOverflowsHorizontally(page), "360px page overflow").toBe(
        false
      );
      expect(await hasClippedDescendants(page), "360px clipped").toEqual([]);

      // Filters remain interactive.
      await page.locator('form select[name="subject"]').selectOption({
        index: 0,
      });
      await page.getByPlaceholder("Search text…").fill(fixture.tag);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(
        page.getByTestId(`tick-question-${fixture.questionIds[0]}`)
      ).toBeVisible({ timeout: 15_000 });

      await page
        .getByTestId(`tick-question-${fixture.questionIds[0]}`)
        .click();
      await page.getByTestId("add-selected-questions").click();
      await expect(page.getByText("Questions (1)")).toBeVisible({
        timeout: 15_000,
      });
      expect(await pageOverflowsHorizontally(page), "after add overflow").toBe(
        false
      );
      expect(await hasClippedDescendants(page), "after add clipped").toEqual(
        []
      );

      // Narrower phone width still fits.
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(`/admin/tests/${testId}`);
      await expect(page.getByTestId("test-builder-csv-import")).toBeVisible();
      await expectUsableInViewport(
        page.getByTestId("add-random-from-filter"),
        "random @320"
      );
      expect(await pageOverflowsHorizontally(page), "320px page overflow").toBe(
        false
      );
      expect(await hasClippedDescendants(page), "320px clipped").toEqual([]);

      // Desktop regression: layout still usable, no overflow.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/admin/tests/${testId}`);
      await expect(page.getByTestId("test-builder-csv-import")).toBeVisible();
      await expect(page.getByTestId("add-random-from-filter")).toBeVisible();
      expect(
        await pageOverflowsHorizontally(page),
        "1280px page overflow"
      ).toBe(false);

      const relevant = consoleErrors.filter(
        (t) =>
          !/favicon|Download the React DevTools|third-party cookie/i.test(t) &&
          !/Failed to load resource:.*favicon/i.test(t)
      );
      expect(relevant, `console errors: ${relevant.join(" | ")}`).toEqual([]);
    } finally {
      await teardownQuestionPoolFixture(fixture, { testId });
    }
  });
});
