/**
 * Staging-only: admin uploads ~200MB PDF via UI; asserts direct-to-R2.
 * Run: E2E_TARGET=staging npx playwright test tests/e2e/pdf-200mb-direct-r2-upload.spec.ts --timeout=600000
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadE2EEnv, STAGING_APP_ORIGIN } from "./load-e2e-env";

const TARGET_BYTES = 200 * 1024 * 1024;
const YEAR_1 = "42eded74-a867-4045-81e4-e438b082d8b3";
const TAG = `U200-${Date.now().toString(36)}`;

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

test.describe("200MB direct-to-R2 admin upload", () => {
  test("admin uploads ~200MB PDF through UI to R2", async ({ page }) => {
    test.setTimeout(600_000);
    const e2e = loadE2EEnv();
    expect(STAGING_APP_ORIGIN).toContain("staging");

    const pdfPath = makePdf(TARGET_BYTES);
    const size = fs.statSync(pdfPath).size;
    console.log(JSON.stringify({ phase: "file", path: pdfPath, bytes: size }));

    const r2Puts: Array<{ url: string; status: number }> = [];
    let putBytes = 0;
    const nextHeavy: string[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("r2.cloudflarestorage.com") && req.method() === "PUT") {
        const len = Number(req.headers()["content-length"] ?? "0");
        if (Number.isFinite(len) && len > 0) putBytes += len;
      }
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

    await page.getByPlaceholder("e.g. Midterms").fill(`Nav ${TAG}`);
    await page.getByRole("button", { name: "Create Sub Nav" }).click();
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

    await form.locator('input[placeholder="Title"]').fill(`${TAG} 200MB`);
    await form
      .locator('input[type="file"][accept*="pdf"]')
      .setInputFiles(pdfPath);

    const started = Date.now();
    await form.getByRole("button", { name: /Add PDF/i }).click();

    await expect(page.getByRole("progressbar")).toBeVisible({
      timeout: 90_000,
    });

    await expect(page.getByText(/PDF saved|Saved/i).first()).toBeVisible({
      timeout: 480_000,
    });
    const durationMs = Date.now() - started;

    expect(nextHeavy.length, "no >5MB POST to Next/Caddy").toBe(0);
    expect(r2Puts.length).toBeGreaterThan(5);
    expect(r2Puts.every((p) => p.status >= 200 && p.status < 300)).toBe(true);
    expect(putBytes).toBeGreaterThan(TARGET_BYTES * 0.9);

    const link = page.getByRole("link", { name: `${TAG} 200MB` }).first();
    await expect(link).toBeVisible({ timeout: 60_000 });
    const href = await link.getAttribute("href");
    const materialId = href?.match(/materials\/([0-9a-f-]+)/)?.[1] ?? null;
    expect(materialId).toBeTruthy();

    console.log(
      JSON.stringify({
        phase: "done",
        bytes: size,
        durationMs,
        r2PutCount: r2Puts.length,
        putBytes,
        materialId,
        href,
        sampleR2Host: r2Puts[0]?.url.includes("r2.cloudflarestorage.com"),
      })
    );

    await page.goto(`/materials/${materialId}/read`);
    const html = await page.content();
    expect(html.includes("r2.cloudflarestorage.com")).toBe(false);
    expect(html.includes("X-Amz-Signature")).toBe(false);

    fs.writeFileSync(
      path.join(os.tmpdir(), "mv-u200-result.json"),
      JSON.stringify({
        materialId,
        bytes: size,
        durationMs,
        putBytes,
        r2PutCount: r2Puts.length,
        tag: TAG,
      })
    );
  });
});
