/**
 * Staging-only regression for the approved synthetic 50 MiB, 16-page PDF.
 * Verifies actual rendered text, not merely the reader shell or input value.
 * Run with E2E_TARGET=staging; no subscription or fixture mutations.
 */
import { test, expect, type Page } from "@playwright/test";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

const MATERIAL_ID = "fe6012bb-7fd9-4c0d-bf6e-8814204ea532";
const FILE_BYTES = 52_431_209;
const PATH = "/api/study-content/" + MATERIAL_ID;
const CAP = 24 * 1024 * 1024;

async function revealChrome(page: Page) {
  const viewer = page.getByTestId("pdf-viewer");
  if (await viewer.getAttribute("data-chrome") === "hidden") {
    const box = await viewer.boundingBox();
    if (!box) throw new Error("Reader bounds unavailable");
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(180, box.height / 2));
  }
  await expect(viewer).toHaveAttribute("data-chrome", "visible");
}

function pageSlot(page: Page, n: number) {
  return page.locator('[data-testid="pdf-page"][data-page-number="' + n + '"]');
}

async function renderedPage(page: Page, n: number) {
  const slot = pageSlot(page, n);
  await expect(slot.locator('[data-testid="pdf-text-layer"] span').filter({ hasText: /\S/ }).first())
    .toBeVisible({ timeout: 30_000 });
  await expect(slot).toBeInViewport({ ratio: 0.01 });
  expect(await slot.locator("canvas").evaluate(el => (el as HTMLCanvasElement).width)).toBeGreaterThan(0);
}

test("synthetic mobile PDF: transient HEAD failure, retry, actual page jump and resume", async ({ page, context }) => {
  test.skip(process.env.E2E_TARGET !== "staging", "staging synthetic fixture only");
  test.setTimeout(150_000);
  page.setDefaultTimeout(8_000);
  const e = loadE2EEnv();
  expect(e.target).toBe("staging");
  expect(e.baseURL).toBe(STAGING_APP_ORIGIN);
  expect(/(staging|test|qa|e2e)/i.test(e.stagingStudentEmail!)).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email").fill(e.stagingStudentEmail!);
  await page.getByLabel("Password").fill(e.stagingStudentPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  expect(new URL(page.url()).origin).toBe(STAGING_APP_ORIGIN);

  const head = await page.request.head(PATH);
  expect(head.status()).toBe(200);
  expect(Number(head.headers()["content-length"])).toBe(FILE_BYTES);
  expect(head.headers()["accept-ranges"]).toMatch(/bytes/i);

  let failHead = true, injected = 0, attempted = 0, count = 0, blocked = false, leaked = false;
  let badRangeStatus = false;
  page.on("request", r => {
    if (/r2\.cloudflarestorage\.com|X-Amz-Signature/i.test(r.url())) leaked = true;
  });
  page.on("response", r => {
    if (new URL(r.url()).pathname === PATH && r.request().method() === "GET" && r.status() !== 206)
      badRangeStatus = true;
  });
  await context.route("**" + PATH, async route => {
    const request = route.request();
    if (request.method() === "HEAD" && failHead) {
      failHead = false;
      injected++;
      return route.fulfill({ status: 503, body: "Synthetic temporary failure" });
    }
    if (request.method() === "GET") {
      const range = request.headers().range?.match(/^bytes=(\d+)-(\d+)$/);
      if (!range) { blocked = true; return route.abort(); }
      attempted += Number(range[2]) - Number(range[1]) + 1;
      count++;
      if (attempted > CAP) { blocked = true; return route.abort(); }
    }
    await route.continue();
  });

  function finishPhase(name: string) {
    console.log(JSON.stringify({ phase: name, attempted, count, blocked, leaked, badRangeStatus }));
    expect(blocked).toBe(false);
    expect(leaked).toBe(false);
    expect(badRangeStatus).toBe(false);
    attempted = 0;
    count = 0;
  }

  try {
    await page.goto("/materials/" + MATERIAL_ID + "/read");
    const error = page.getByTestId("pdf-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    expect(injected).toBe(1);
    console.log("TRANSIENT_HEAD_ERROR_PASS");
    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({ timeout: 45_000 });
    const initial = Number(await page.getByTestId("pdf-page-input").inputValue());
    expect(initial).toBeGreaterThanOrEqual(1);
    expect(initial).toBeLessThanOrEqual(16);
    await renderedPage(page, initial);
    finishPhase("retry renders actual page " + initial);

    const target = initial <= 8 ? 12 : 4;
    await revealChrome(page);
    const input = page.getByTestId("pdf-page-input");
    await input.fill(String(target));
    await input.press("Enter");
    await renderedPage(page, target);
    await expect(input).toHaveValue(String(target));
    finishPhase("jump renders actual page " + target);

    await page.waitForTimeout(1500); // reading-position debounce
    await page.reload();
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({ timeout: 45_000 });
    await renderedPage(page, target);
    await expect(page.getByTestId("pdf-page-input")).toHaveValue(String(target));
    finishPhase("reload resumes actual page " + target);
  } finally {
    console.log(JSON.stringify({ attempted, count, blocked, leaked, badRangeStatus }));
  }
});
