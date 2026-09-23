/**
 * Quick oversize rejection test only (uses existing Sub Nav or creates one).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://staging.medversepk.com";
const PDF = path.join(__dirname, "tmp-qa-pdfs", "E-25mb-plus1.pdf");
const TAG = `OV-${Date.now().toString(36)}`;

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL);
await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
await page.goto(`${BASE}/admin/past-papers`);
for (let i = 0; i < 3; i++) {
  if (await page.getByPlaceholder(/Midterms/i).count()) break;
  const yearBtn = page.locator("button[type=submit]").filter({ hasText: /1st Year MBBS/i }).first();
  if (await yearBtn.count()) { await yearBtn.click(); await page.waitForTimeout(1200); continue; }
  await page.goto(`${BASE}/admin/past-papers`);
}
const sub = `${TAG}-Sub`;
await page.getByPlaceholder(/Midterms/i).first().fill(sub);
await page.getByRole("button", { name: "Create Sub Nav" }).click();
await page.waitForTimeout(1200);
await page.reload();
const card = page.locator("[data-slot='card']").filter({ hasText: sub }).first();
const form = card.locator("form").filter({ has: page.locator('input[name="file"]') }).first();
await form.locator('input[name="title"]').fill(`${TAG}-E`);
await form.locator('input[name="file"]').setInputFiles(PDF);
const t0 = Date.now();
await form.getByRole("button", { name: /Add PDF/i }).click();
let msg = "";
while (Date.now() - t0 < 120000) {
  msg = (await page.locator("[data-sonner-toast]").allTextContents()).join(" | ");
  if (/pdf_too_large|PDF saved|error|fail|too large|Unexpected/i.test(msg)) break;
  if (!(await form.getByRole("button", { name: /Uploading/i }).count()) && Date.now() - t0 > 3000) break;
  await page.waitForTimeout(800);
}
console.log(JSON.stringify({ size: fs.statSync(PDF).size, elapsedMs: Date.now() - t0, msg, visible: (await page.getByText(`${TAG}-E`).count()) > 0 }, null, 2));
await browser.close();
