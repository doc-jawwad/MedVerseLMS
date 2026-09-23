/**
 * Staging-only: admin uploads large PDFs via UI; asserts direct-to-R2.
 *
 *   E2E_TARGET=staging E2E_PDF_PATH=... E2E_PDF_BYTES=524288000 \
 *     npx playwright test tests/e2e/pdf-large-direct-r2-upload.spec.ts --timeout=0
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

const YEAR_1 = "42eded74-a867-4045-81e4-e438b082d8b3";
const TARGET_BYTES = Number(process.env.E2E_PDF_BYTES || String(200 * 1024 * 1024));
const TAG = `ULG-${TARGET_BYTES}-${Date.now().toString(36)}`;
const RESULT_PATH =
  process.env.E2E_RESULT_PATH ||
  path.join(os.tmpdir(), `mv-ulg-${TARGET_BYTES}-result.json`);

function makePdf(bytes: number): string {
  const prebuilt = process.env.E2E_PDF_PATH;
  if (prebuilt && fs.existsSync(prebuilt)) return prebuilt;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mv-pdf-"));
  const out = path.join(dir, `${TAG}.pdf`);
  const r = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "scripts/gen-synthetic-pdf.mjs"),
      out,
      String(bytes),
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    throw new Error(`gen pdf failed: ${r.stderr || r.stdout}`);
  }
  return out;
}

test.describe(`large direct-to-R2 admin upload (${TARGET_BYTES} bytes)`, () => {
  test(`admin uploads ~${Math.round(TARGET_BYTES / (1024 * 1024))}MB PDF through UI to R2`, async ({
    page,
  }) => {
    // Wall clock: allow ~15 min/GB of upload + overhead
    test.setTimeout(Math.max(600_000, Math.ceil(TARGET_BYTES / (1024 * 1024)) * 15_000));
    const e2e = loadE2EEnv();
    expect(STAGING_APP_ORIGIN).toContain("staging");

    const pdfPath = makePdf(TARGET_BYTES);
    const size = fs.statSync(pdfPath).size;
    console.log(JSON.stringify({ phase: "file", path: pdfPath, bytes: size, tag: TAG }));

    const r2Puts: Array<{ url: string; status: number }> = [];
    const nextHeavy: string[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (
        url.startsWith(STAGING_APP_ORIGIN) &&
        req.method() === "POST" &&
        Number(req.headers()["content-length"] ?? "0") > 5 * 1024 * 1024
      ) {
        nextHeavy.push(url);
      }
    });
    page.on("response", (res) => {
      const url = res.url();
      if (
        url.includes("r2.cloudflarestorage.com") &&
        res.request().method() === "PUT"
      ) {
        r2Puts.push({ url: url.split("?")[0]!, status: res.status() });
      }
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(e2e.adminEmail!);
    await page.getByLabel("Password").fill(e2e.adminPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/admin/, { timeout: 60_000 });

    await page.goto(`/admin/past-papers?year=${YEAR_1}`);
    await expect(
      page.getByRole("heading", { name: /Past Papers/i }).first()
    ).toBeVisible({ timeout: 30_000 });

    await page.getByPlaceholder("e.g. Midterms").first().fill(`Nav ${TAG}`);
    await page.getByRole("button", { name: "Create Sub Nav" }).first().click();
    await expect(
      page.locator(`select option`, { hasText: `Nav ${TAG}` })
    ).toHaveCount(1, { timeout: 30_000 });
    await page.reload();
    await expect(
      page.locator(`[data-slot=card]`).filter({ hasText: `Nav ${TAG}` }).first()
    ).toBeVisible({ timeout: 30_000 });

    const card = page
      .locator("[data-slot=card]")
      .filter({ hasText: `Nav ${TAG}` })
      .first();
    const form = card
      .locator("form")
      .filter({ has: page.locator('input[type="file"][accept*="pdf"]') })
      .first();

    const title = `${TAG} ${Math.round(size / (1024 * 1024))}MB`;
    await form.locator('input[placeholder="Title"]').fill(title);
    await form
      .locator('input[type="file"][accept*="pdf"]')
      .setInputFiles(pdfPath);

    const started = Date.now();
    await form.getByRole("button", { name: /Add PDF/i }).click();

    await expect(page.getByRole("progressbar")).toBeVisible({
      timeout: 90_000,
    });

    await expect(page.getByText(/PDF saved|Saved/i).first()).toBeVisible({
      timeout: Math.max(480_000, Math.ceil(TARGET_BYTES / (1024 * 1024)) * 12_000),
    });
    const durationMs = Date.now() - started;

    expect(nextHeavy.length, "no >5MB POST to Next/Caddy").toBe(0);
    // Multipart threshold is 32MB — expect many part PUTs for large files
    expect(r2Puts.length).toBeGreaterThan(2);
    expect(r2Puts.every((p) => p.status >= 200 && p.status < 300)).toBe(true);

    const link = page.getByRole("link", { name: title }).first();
    await expect(link).toBeVisible({ timeout: 60_000 });
    const href = await link.getAttribute("href");
    const materialId = href?.match(/materials\/([0-9a-f-]+)/)?.[1] ?? null;
    expect(materialId).toBeTruthy();

    const result = {
      phase: "done",
      tag: TAG,
      title,
      bytes: size,
      durationMs,
      r2PutCount: r2Puts.length,
      materialId,
      href,
      sampleR2: r2Puts[0]?.url.includes("r2.cloudflarestorage.com"),
      nextHeavyCount: nextHeavy.length,
    };
    console.log(JSON.stringify(result));
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));

    await page.goto(`/materials/${materialId}/read`);
    const html = await page.content();
    expect(html.includes("r2.cloudflarestorage.com")).toBe(false);
    expect(html.includes("X-Amz-Signature")).toBe(false);
  });
});
